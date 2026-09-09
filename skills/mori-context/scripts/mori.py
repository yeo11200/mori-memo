#!/usr/bin/env python3
"""MORI 0.4 local JSON-frontmatter bridge. No network or third-party packages."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import unicodedata
import uuid
from datetime import datetime, timezone

MAX_BYTES = 4_000_000


def bounded_text(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected a regular non-symlink file')
    with path.open('rb') as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('File too large')
    return data.decode('utf-8')


def resolve_vault(explicit=None):
    selected = explicit or os.environ.get('MORI_VAULT_PATH')
    if not selected and os.environ.get('WIKI_DATA_DIR'):
        selected = str(Path(os.environ['WIKI_DATA_DIR']) / 'Vault')
    if not selected:
        base = Path.home() / 'Library/Application Support'
        candidates = [base / name / 'Vault' for name in ('personal-wiki', 'MORI')]
        candidates = [p for p in candidates if (p / 'Notes').is_dir()]
        if len(candidates) != 1:
            raise ValueError('Set --vault or MORI_VAULT_PATH: no unique MORI vault found')
        selected = candidates[0]
    root = Path(selected).expanduser().resolve()
    for name in ('Notes', '.wiki'):
        if (root / name).is_symlink() or not (root / name).is_dir():
            raise ValueError('Not a MORI vault: Notes and .wiki directories required')
    return root


def folders(root):
    values = json.loads(bounded_text(root / '.wiki/folders.json'))
    if not isinstance(values, list) or not all(isinstance(x, str) for x in values):
        raise ValueError('Invalid folder registry')
    return values


def read_note(root, identifier):
    if not re.fullmatch(r'[a-f0-9-]{36}', identifier):
        raise ValueError('Invalid document ID')
    text = bounded_text(root / 'Notes' / (identifier + '.md'))
    match = re.fullmatch(r'---\n(.*?)\n---\n(.*)', text, re.S)
    if not match:
        raise ValueError('Unsupported MORI frontmatter')
    meta = json.loads(match[1])
    if meta.get('id') != identifier or any(not isinstance(meta.get(k), str) for k in ('title', 'folder', 'revision')):
        raise ValueError('Invalid document metadata')
    return dict(documentId=identifier, title=meta['title'], scope=meta['folder'],
                updatedAt=meta.get('updatedAt'), revision=meta['revision'],
                freshness='unknown', content=match[2])


def normalize(value):
    return unicodedata.normalize('NFKC', value).casefold()


def search(root, query, limit, scope=None):
    terms = list(dict.fromkeys(re.findall(r'[\w./-]+', normalize(query))))
    if not terms:
        raise ValueError('A non-empty search query is required')
    results, skipped = [], 0
    for path in sorted((root / 'Notes').glob('*.md')):
        try:
            note = read_note(root, path.stem)
        except (OSError, ValueError, TypeError, AttributeError):
            skipped += 1
            continue
        if scope is not None and note['scope'] != scope:
            continue
        title, folder, body = (normalize(note[k]) for k in ('title', 'scope', 'content'))
        matched = [t for t in terms if t in title or t in folder or t in body]
        score = sum(5 * (t in title) + 2 * (t in folder) + (t in body) for t in terms)
        if not score:
            continue
        content = note.pop('content')
        # Line selection preserves original Korean text even when normalization changes length.
        excerpt = next((line for line in content.splitlines() if any(t in normalize(line) for t in matched)), content)
        results.append(dict(note, summary=excerpt[:320], relevance=score, matchedTerms=matched))
    results.sort(key=lambda n: (-n['relevance'], n['documentId']))
    return dict(results=results[:limit], totalMatches=len(results), skippedDocuments=skipped,
                searchMode='keyword', freshnessPolicy='unknown-until-code-verified')


def proposal(root, path):
    raw = json.loads(bounded_text(Path(path)))
    if not isinstance(raw, dict) or set(raw) != {'title', 'body', 'folder', 'reason', 'sourceRefs'}:
        raise ValueError('Proposal requires exactly title, body, folder, reason, sourceRefs')
    for key in ('title', 'body', 'folder', 'reason'):
        if not isinstance(raw[key], str) or not raw[key].strip():
            raise ValueError('Proposal fields must be non-empty strings')
    if len(raw['title']) > 160 or len(raw['body']) > 2_000_000:
        raise ValueError('Title or body exceeds MORI limits')
    if raw['folder'] not in folders(root):
        raise ValueError('Select an existing MORI folder')
    refs = raw['sourceRefs']
    if not isinstance(refs, list) or not refs or not all(isinstance(x, str) and x.strip() for x in refs):
        raise ValueError('sourceRefs must contain source file references')
    body = raw['body'] + '\n\n## 작성 근거\n\n' + raw['reason'] + '\n\n' + '\n'.join('- ' + ref for ref in refs) + '\n'
    if len(body.encode('utf-16-le')) // 2 > 2_000_000:
        raise ValueError('Final body exceeds MORI limits')
    result = dict(vault=str(root), title=raw['title'], folder=raw['folder'], body=body,
                  reason=raw['reason'], sourceRefs=refs, operation='create-only')
    digest = hashlib.sha256(json.dumps(result, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return dict(result, approvalHash=digest)


def create(root, path, approval):
    draft = proposal(root, path)
    if not approval or approval != draft['approvalHash']:
        raise ValueError('Approval hash missing or proposal/target changed; review again')
    identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, 'mori-proposal:' + approval))
    destination = root / 'Notes' / (identifier + '.md')
    trash = root / '.wiki/trash'
    if trash.is_symlink() or (trash / (identifier + '.md')).exists():
        raise ValueError('Original creation is in trash; restore in MORI instead')
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    meta = dict(id=identifier, wiki_id=identifier, title=draft['title'], folder=draft['folder'],
                pinned=False, createdAt=now, updatedAt=now, revision=str(uuid.uuid4()), aliases=[])
    payload = '---\n' + json.dumps(meta, ensure_ascii=False, indent=2) + '\n---\n' + draft['body']
    # Link publishes a complete file atomically and refuses to overwrite an existing note.
    fd, temporary = tempfile.mkstemp(prefix='.mori-', suffix='.tmp', dir=root / 'Notes')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError:
            previous = read_note(root, identifier)
            if any(previous[k] != draft[v] for k, v in [('title', 'title'), ('scope', 'folder'), ('content', 'body')]):
                raise ValueError('Previously created note changed; refusing to overwrite')
            return dict(documentId=identifier, created=False, alreadyExists=True)
    finally:
        os.unlink(temporary)
    return dict(documentId=identifier, created=True, refresh='Save pending edits and restart MORI to refresh the list')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('status')
    query = sub.add_parser('search')
    query.add_argument('--query', required=True)
    query.add_argument('--limit', type=int, default=6, choices=range(1, 21))
    query.add_argument('--scope')
    read = sub.add_parser('read')
    read.add_argument('--id', required=True)
    read.add_argument('--offset', type=int, default=0)
    read.add_argument('--length', type=int, default=6000)
    for name in ('propose', 'create'):
        command = sub.add_parser(name)
        command.add_argument('--file', required=True)
        if name == 'create':
            command.add_argument('--approve', required=True)
    args = parser.parse_args()
    try:
        root = resolve_vault(args.vault)
        if args.command == 'status':
            result = dict(vault=str(root), bridgeVersion='0.1.0', folders=folders(root),
                          appRequired=False, capabilities=['search', 'read', 'propose', 'create-after-approval'])
        elif args.command == 'search':
            result = search(root, args.query, args.limit, args.scope)
        elif args.command == 'read':
            if args.offset < 0 or not 1 <= args.length <= 20000:
                raise ValueError('offset >= 0 and length between 1 and 20000 required')
            result = read_note(root, args.id)
            body = result['content']
            end = args.offset + args.length
            result.update(content=body[args.offset:end], offset=args.offset, totalCharacters=len(body),
                          nextOffset=end if end < len(body) else None)
        elif args.command == 'propose':
            result = proposal(root, args.file)
        else:
            result = create(root, args.file, args.approve)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, TypeError, AttributeError) as error:
        # Our exact ValueErrors carry controlled messages; parser/OS exceptions can contain private data.
        message = str(error) if type(error) is ValueError else 'MORI operation failed. Check vault path, permissions and document format.'
        print(json.dumps(dict(error=type(error).__name__, message=message), ensure_ascii=False))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
