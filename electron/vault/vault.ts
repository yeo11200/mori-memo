import { mkdir, readFile, writeFile, rename, readdir, copyFile, cp, stat, rm, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { Note } from '../../shared/types';
import { handleAppendLink } from '../../shared/link-edit';
import { handleAppendDailyTasks, handleDailyDate, handleDailyTasks, handleLocalDate } from '../../shared/daily';
import type { DailyTransfer, DailyResult } from '../../shared/daily';
import { handleWorkMerge } from '../../shared/work-merge';
import type { WorkBatch, WorkSnapshot } from '../../shared/work';
import { handleCalendarMerge } from '../../shared/calendar-merge';
import type { CalendarBatch, CalendarSnapshot } from '../../shared/calendar';
import type { AppleNote, AppleProvenance, AppleResult } from '../../shared/apple-notes';
import { handleContentHash, handleImportStatus } from '../apple-notes/compare';

const MAX_BODY = 2_000_000;
const handleHash = (text: string) => createHash('sha256').update(text).digest('hex');
const handleValidateId = (id: string) => {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('잘못된 문서 ID입니다.');
  return id;
};
const handleSerialize = (note: Note) => {
  const { body, ...meta } = note;
  return `---\n${JSON.stringify({ ...meta, wiki_id: note.id }, null, 2)}\n---\n${body}`;
};
const handleDeserialize = (text: string): Note => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('문서 메타데이터를 읽을 수 없습니다.');
  const meta = JSON.parse(match[1]);
  handleValidateId(meta.id);
  if (typeof meta.title !== 'string' || typeof meta.revision !== 'string' || typeof meta.folder !== 'string') throw new Error('문서 정보가 올바르지 않습니다.');
  return { id: meta.id, title: meta.title, body: match[2], folder: meta.folder, pinned: !!meta.pinned, createdAt: meta.createdAt, updatedAt: meta.updatedAt, revision: meta.revision, appleSource: meta.appleSource, dailyDate: typeof meta.dailyDate === 'string' ? meta.dailyDate : undefined, dailyTaskKeys: Array.isArray(meta.dailyTaskKeys) ? meta.dailyTaskKeys.filter((key: unknown) => typeof key === 'string') : undefined, workSnapshots: Array.isArray(meta.workSnapshots) ? meta.workSnapshots : undefined, calendarSnapshots: Array.isArray(meta.calendarSnapshots) ? meta.calendarSnapshots : undefined, aliases: Array.isArray(meta.aliases) ? meta.aliases.filter((value: unknown) => typeof value === 'string') : [] };
};
const handleAtomicWrite = async (path: string, text: string) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);
};
const DEFAULT_FOLDER = '미분류';
const handleValidateFolder = (name: string) => {
  if (typeof name !== 'string') throw new Error('폴더 이름을 확인해 주세요.');
  const value = name.trim();
  if (!value || value.length > 80 || /[\\/:*?"<>|\0\r\n]/.test(value) || value === '.' || value === '..') throw new Error('폴더 이름을 확인해 주세요.');
  return value;
};
const handleAppleFolder = (folder: string) => handleValidateFolder(folder.replace(/[\\/:*?"<>|]/g, ' › ').replace(/\s+›\s+/g, ' › ').trim().slice(0, 80) || DEFAULT_FOLDER);

/** Markdown 원문을 저장하고 버전 충돌과 삭제 복구를 관리합니다. */
export class Vault {
  readonly root: string;
  warnings: string[] = [];
  private fingerprints = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string, private readonly testing?: { beforeFolderCommit?(): void | Promise<void> }) { this.root = root; }

  private handleQueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async handleInitialize() {
    await Promise.all(['Notes', 'Attachments', '.wiki/history', '.wiki/trash', '.wiki/results'].map(folder => mkdir(join(this.root, folder), { recursive: true })));
    const notes = await this.handleList();
    let folders: string[] = [];
    try { const parsed = JSON.parse(await readFile(this.handleFoldersPath(), 'utf8')); if (!Array.isArray(parsed)) throw new Error('Invalid folders'); folders = parsed; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warnings.push('폴더 목록을 읽지 못해 문서에서 복구했습니다.'); }
    const merged = this.handleNormalizeFolders([...folders, DEFAULT_FOLDER, ...notes.map(note => note.folder)]);
    await handleAtomicWrite(this.handleFoldersPath(), JSON.stringify(merged, null, 2));
  }

  private handleFoldersPath() { return join(this.root, '.wiki/folders.json'); }
  private handleNormalizeFolders(values: unknown[]) { return [...new Set(values.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(value => value && value.length <= 500 && !/[\0\r\n]/.test(value)))].sort((a, b) => a.localeCompare(b, 'ko')); }
  private async handleReadFolders() { return this.handleNormalizeFolders(JSON.parse(await readFile(this.handleFoldersPath(), 'utf8'))); }
  private async handleWriteFolders(folders: string[]) { await handleAtomicWrite(this.handleFoldersPath(), JSON.stringify(this.handleNormalizeFolders(folders), null, 2)); }

  async handleListFolders(): Promise<string[]> { return this.handleReadFolders(); }

  handleCreateFolder(name: string): Promise<void> {
    return this.handleQueue(async () => {
      const folder = handleValidateFolder(name);
      const folders = await this.handleReadFolders();
      if (folders.includes(folder)) throw new Error('이미 있는 폴더입니다.');
      await this.handleWriteFolders([...folders, folder]);
    });
  }

  private async handleMoveFolder(from: string, to: string, removeSource: boolean) {
    const sourceFolder = from;
    const targetFolder = handleValidateFolder(to);
    if (sourceFolder === targetFolder) return;
    const folders = await this.handleReadFolders();
    if (!folders.includes(sourceFolder)) throw new Error('폴더를 찾을 수 없습니다.');
    if (sourceFolder === DEFAULT_FOLDER) throw new Error('기본 폴더는 변경할 수 없습니다.');
    if (!removeSource && folders.includes(targetFolder)) throw new Error('같은 이름의 폴더가 있습니다.');
    const affected = (await this.handleList()).filter(note => note.folder === sourceFolder);
    const originals = new Map<string, string>();
    const previousFolders = JSON.stringify(folders, null, 2);
    try {
      for (const previous of affected) {
        const path = join(this.root, 'Notes', `${previous.id}.md`);
        const source = await readFile(path, 'utf8');
        if (this.fingerprints.get(previous.id) !== handleHash(source)) throw new Error('외부에서 변경된 메모가 있어 폴더를 이동하지 않았습니다.');
        originals.set(path, source);
        const aliases = new Set(previous.aliases || []);
        aliases.add(`${sourceFolder}/${previous.title}`);
        const note = { ...previous, folder: targetFolder, aliases: [...aliases], updatedAt: new Date().toISOString(), revision: randomUUID() };
        const historyDir = join(this.root, '.wiki/history', previous.id);
        await mkdir(historyDir, { recursive: true });
        await writeFile(join(historyDir, `${previous.revision}.md`), source, { mode: 0o600 });
        const text = handleSerialize(note);
        await handleAtomicWrite(path, text);
        this.fingerprints.set(note.id, handleHash(text));
      }
      const nextFolders = folders.filter(folder => folder !== sourceFolder);
      if (!nextFolders.includes(targetFolder)) nextFolders.push(targetFolder);
      await this.testing?.beforeFolderCommit?.();
      await this.handleWriteFolders(nextFolders);
    } catch (error) {
      for (const [path, text] of originals) {
        await handleAtomicWrite(path, text);
        this.fingerprints.set(basename(path, '.md'), handleHash(text));
      }
      await handleAtomicWrite(this.handleFoldersPath(), previousFolders);
      throw error;
    }
  }

  handleRenameFolder(from: string, to: string): Promise<void> { return this.handleQueue(() => this.handleMoveFolder(from, to, false)); }
  handleDeleteFolder(name: string): Promise<void> {
    const source = name;
    if (source === DEFAULT_FOLDER) return Promise.reject(new Error('기본 폴더는 삭제할 수 없습니다.'));
    return this.handleQueue(() => this.handleMoveFolder(source, DEFAULT_FOLDER, true));
  }

  async handleList(): Promise<Note[]> {
    const notes: Note[] = [];
    this.warnings = [];
    for (const filename of (await readdir(join(this.root, 'Notes'))).filter(name => name.endsWith('.md'))) {
      try {
        const text = await readFile(join(this.root, 'Notes', filename), 'utf8');
        const note = handleDeserialize(text);
        if (filename !== `${note.id}.md`) throw new Error('문서 ID와 파일 이름이 다릅니다.');
        if (!this.fingerprints.has(note.id)) this.fingerprints.set(note.id, handleHash(text));
        notes.push(note);
      } catch (error) { this.warnings.push(`${filename}: ${error instanceof Error ? error.message : '읽기 실패'}`); }
    }
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async handleGet(id: string) {
    return handleDeserialize(await readFile(join(this.root, 'Notes', `${handleValidateId(id)}.md`), 'utf8'));
  }

  handleCreate(title: string, body = '', folder = DEFAULT_FOLDER): Promise<Note> {
    return this.handleQueue(() => this.handleCreateNow(title, body, folder));
  }

  private async handleCreateNow(title: string, body: string, folder: string, appleSource?: AppleProvenance, dailyDate?: string): Promise<Note> {
      if (body.length > MAX_BODY) throw new Error('메모는 2MB 이하로 작성해 주세요.');
      const now = new Date().toISOString();
      const normalizedFolder = handleValidateFolder(folder || DEFAULT_FOLDER);
      const note: Note = { id: randomUUID(), title: title.trim().slice(0, 160) || '제목 없는 메모', body, folder: normalizedFolder, pinned: false, createdAt: now, updatedAt: now, revision: randomUUID(), aliases: [], appleSource, dailyDate };
      const text = handleSerialize(note);
      await handleAtomicWrite(join(this.root, 'Notes', `${note.id}.md`), text);
      this.fingerprints.set(note.id, handleHash(text));
      const folders = await this.handleReadFolders();
      if (!folders.includes(normalizedFolder)) await this.handleWriteFolders([...folders, normalizedFolder]);
      return note;
  }


  handleTodayDaily(): Promise<Note> {
    return this.handleQueue(() => this.handleDailyNow(handleLocalDate()));
  }

  handleWorkApply(batch: WorkBatch): Promise<Note> {
    return this.handleQueue(async () => {
      if (batch.date !== handleLocalDate()) throw new Error('날짜가 바뀌었습니다. 오늘 데일리에서 다시 가져와 주세요.');
      const daily = await this.handleDailyNow(batch.date);
      const merged = handleWorkMerge(daily.body, daily.workSnapshots || [], batch);
      return this.handleSaveNow({ ...daily, body: merged.body }, undefined, undefined, undefined, merged.snapshots);
    });
  }

  handleCalendarApply(batch: CalendarBatch): Promise<Note> {
    return this.handleQueue(async () => {
      if (batch.date !== handleLocalDate()) throw new Error('날짜가 바뀌었습니다. 오늘 일정을 다시 가져와 주세요.');
      const daily = await this.handleDailyNow(batch.date);
      const merged = handleCalendarMerge(daily.body, daily.calendarSnapshots || [], batch);
      return this.handleSaveNow({ ...daily, body: merged.body }, undefined, undefined, merged.snapshots);
    });
  }

  private async handleDailyNow(date: string): Promise<Note> {
    const matches = (await this.handleList()).filter(note => handleDailyDate(note) === date);
    if (matches.length > 1) throw new Error('오늘 데일리가 여러 개입니다. 남길 노트 하나를 정하고 나머지는 제목을 변경하거나 휴지통으로 옮겨 주세요.');
    if (matches[0]) return matches[0].dailyDate ? matches[0] : this.handleSaveNow(matches[0], undefined, { dailyDate: date });
    if ((await this.handleListTrash()).some(note => handleDailyDate(note) === date)) throw new Error('오늘 데일리가 휴지통에 있습니다. 복원한 뒤 다시 열어 주세요.');
    return this.handleCreateNow(date + ' 데일리 노트', '## 오늘 일정\n\n## 오늘 할 일\n\n## 오늘의 기록\n\n', '데일리', undefined, date);
  }

  handleDailyTransfer(input: DailyTransfer): Promise<DailyResult> {
    return this.handleQueue(async () => {
      if (!input || !Array.isArray(input.tasks) || input.tasks.length > 100 || (!input.tasks.length && !input.custom)) throw new Error('가져올 할 일을 1~100개 선택해 주세요.');
      const items: { key: string; text: string; source: Note }[] = [];
      const sources = new Map<string, Note>();
      const handleSource = async (id: string, revision: string) => {
        const source = sources.get(id) || await this.handleGet(id);
        sources.set(id, source);
        const text = await readFile(join(this.root, 'Notes', source.id + '.md'), 'utf8');
        if (source.revision !== revision || this.fingerprints.get(id) !== handleHash(text)) throw new Error('원본 메모가 변경되었습니다. 창을 닫고 다시 선택해 주세요.');
        return source;
      };
      for (const selection of input.tasks) {
        if (!selection || !Number.isInteger(selection.line)) throw new Error('할 일 선택이 올바르지 않습니다.');
        const source = await handleSource(selection.noteId, selection.revision);
        const candidates = handleDailyTasks(source.body);
        const task = candidates.find(item => item.line === selection.line);
        if (!task) throw new Error('선택한 할 일이 완료되었거나 변경되었습니다. 다시 선택해 주세요.');
        const occurrence = handleDailyTasks(source.body, true).filter(item => item.text === task.text && item.line <= task.line).length;
        const key = task.originKey || handleHash(JSON.stringify([source.id, task.text, occurrence]));
        items.push({ key, text: task.text, source });
      }
      if (input.custom) {
        const { noteId, revision, text } = input.custom;
        if (typeof text !== 'string' || !text.trim() || text.length > 500 || /[\r\n]/.test(text)) throw new Error('할 일은 한 줄, 500자 이내로 작성해 주세요.');
        const source = await handleSource(noteId, revision);
        items.push({ key: handleHash(JSON.stringify([source.id, text.trim(), 'custom'])), text: text.trim(), source });
      }
      const date = handleLocalDate();
      if (items.some(item => handleDailyDate(item.source) === date)) throw new Error('오늘 데일리의 할 일은 이미 오늘에 포함되어 있습니다.');
      const daily = await this.handleDailyNow(date);
      const keys = new Set(daily.dailyTaskKeys || []);
      for (const marker of daily.body.matchAll(/<!-- mori-task:([a-f0-9]{64}) -->/g)) keys.add(marker[1]);
      const additions: string[] = [];
      for (const item of items) {
        if (keys.has(item.key)) continue;
        keys.add(item.key);
        const label = item.source.title.replace(/[\[\]|\r\n]/g, '').trim() || '원본 메모';
        additions.push('- [ ] ' + item.text + ' — [[' + item.source.id + '|' + label + ']] <!-- mori-task:' + item.key + ' -->');
      }
      if (!additions.length) return { note: daily, added: 0, skipped: items.length };
      const body = handleAppendDailyTasks(daily.body, additions);
      const note = await this.handleSaveNow({ ...daily, body }, undefined, { dailyDate: date, dailyTaskKeys: [...keys] });
      return { note, added: additions.length, skipped: items.length - additions.length };
    });
  }

  handleSave(input: Note): Promise<Note> {
    return this.handleQueue(() => this.handleSaveNow(input));
  }

  handleAddLink(sourceId: string, targetId: string, revision: string, reason: string): Promise<Note> {
    return this.handleQueue(async () => {
      const source = await this.handleGet(sourceId);
      if (typeof revision !== 'string' || source.revision !== revision) throw new Error('다른 곳에서 변경된 메모입니다. 다시 열어 확인해 주세요.');
      const target = await this.handleGet(targetId);
      return this.handleSaveNow({ ...source, body: handleAppendLink(source, target, await this.handleList(), reason) });
    });
  }

  private async handleSaveNow(input: Note, appleSource?: AppleProvenance, dailyMeta?: Pick<Note, 'dailyDate' | 'dailyTaskKeys'>, calendarSnapshots?: CalendarSnapshot[], workSnapshots?: WorkSnapshot[]): Promise<Note> {
      const id = handleValidateId(input.id);
      if (typeof input.body !== 'string' || input.body.length > MAX_BODY || typeof input.title !== 'string' || typeof input.folder !== 'string') throw new Error('메모 내용이 올바르지 않습니다.');
      const path = join(this.root, 'Notes', `${id}.md`);
      const source = await readFile(path, 'utf8');
      const previous = handleDeserialize(source);
      if (previous.revision !== input.revision || this.fingerprints.get(id) !== handleHash(source)) throw new Error('다른 곳에서 변경된 메모입니다. 작성 중인 내용을 복사한 뒤 앱을 다시 열어 확인해 주세요.');
      const title = input.title.trim().slice(0, 160) || '제목 없는 메모';
      const knownFolders = await this.handleReadFolders();
      const folder = knownFolders.includes(input.folder) ? input.folder : handleValidateFolder(input.folder || DEFAULT_FOLDER);
      if (!appleSource && !dailyMeta && !calendarSnapshots && !workSnapshots && title === previous.title && folder === previous.folder && input.body === previous.body && input.pinned === previous.pinned) return previous;
      const aliases = new Set(previous.aliases || []);
      if (title !== previous.title || folder !== previous.folder) {
        aliases.add(previous.title);
        aliases.add(`${previous.folder}/${previous.title}`);
      }
      const note: Note = { ...previous, dailyDate: handleDailyDate(previous), ...dailyMeta, calendarSnapshots: calendarSnapshots || previous.calendarSnapshots, workSnapshots: workSnapshots || previous.workSnapshots, title, folder, body: input.body, pinned: !!input.pinned, aliases: [...aliases], appleSource: appleSource || previous.appleSource, updatedAt: new Date().toISOString(), revision: randomUUID() };
      const historyDir = join(this.root, '.wiki/history', id);
      await mkdir(historyDir, { recursive: true });
      if (title !== previous.title || folder !== previous.folder || input.body !== previous.body || input.pinned !== previous.pinned) await writeFile(join(historyDir, `${previous.revision}.md`), source, { mode: 0o600 });
      const text = handleSerialize(note);
      await handleAtomicWrite(path, text);
      this.fingerprints.set(id, handleHash(text));
      const folders = await this.handleReadFolders();
      if (!folders.includes(folder)) await this.handleWriteFolders([...folders, folder]);
      return note;
  }

  /** 원본 ID와 가져오기 정보를 본문과 함께 원자적으로 저장합니다. */
  handleImportApple(source: AppleNote, choice?: 'keep' | 'apple' | 'merge', revision?: string, mergedBody?: string): Promise<AppleResult> {
    return this.handleQueue(async () => {
      const notes = await this.handleList();
      const matches = notes.filter(note => note.appleSource?.sourceId === source.id);
      if (matches.length > 1) throw new Error('같은 원본을 참조하는 메모가 여럿입니다.');
      const note = matches[0];
      const base = { sourceId: source.id, title: source.title, noteId: note?.id };
      if (!note && (await this.handleListTrash()).some(item => item.appleSource?.sourceId === source.id)) return { ...base, status: 'trashed', message: '휴지통에서 복원한 후 다시 동기화하세요.' };
      if (source.error) return { ...base, status: 'failed', message: source.error };
      if (choice && (!note || note.revision !== revision)) throw new Error('메모가 변경되었습니다. 검토 화면을 다시 열어 주세요.');
      const status = handleImportStatus(source, note);
      if (!choice && status === 'review') return { ...base, status };
      const now = new Date().toISOString();
      if (!choice && status === 'unchanged') {
        await this.handleSaveNow(note!, { ...note!.appleSource!, sourceTitle: source.title, sourceFolder: source.folder, lastSeenAt: now, warnings: source.warnings });
        return { ...base, status };
      }
      const content = choice === 'keep' ? note! : choice === 'merge' ? { title: note!.title, body: mergedBody! } : source;
      if (typeof content.body !== 'string') throw new Error('병합할 내용을 입력해 주세요.');
      const provenance: AppleProvenance = { sourceId: source.id, sourceTitle: source.title, sourceFolder: source.folder, importedAt: note?.appleSource?.importedAt || now, lastSeenAt: now, sourceHash: handleContentHash(source), importedHash: choice === 'keep' || choice === 'merge' ? note!.appleSource!.importedHash : handleContentHash(content), warnings: source.warnings };
      // 처음 가져올 때만 Apple 원본 폴더를 사용합니다. 이후 MORI에서 이동한 폴더는 동기화로 되돌리지 않습니다.
      const saved = note ? await this.handleSaveNow({ ...note, title: content.title, body: content.body }, provenance) : await this.handleCreateNow(content.title, content.body, handleAppleFolder(source.folder), provenance);
      return { ...base, noteId: saved.id, status: note ? 'updated' : 'created' };
    });
  }

  handleTrash(id: string) {
    return this.handleQueue(async () => {
      handleValidateId(id);
      await rename(join(this.root, 'Notes', `${id}.md`), join(this.root, '.wiki/trash', `${id}.md`));
      this.fingerprints.delete(id);
    });
  }

  async handleListTrash(): Promise<Note[]> {
    const names = (await readdir(join(this.root, '.wiki/trash'))).filter(name => name.endsWith('.md'));
    return Promise.all(names.map(async name => handleDeserialize(await readFile(join(this.root, '.wiki/trash', name), 'utf8'))));
  }

  handleRestore(id: string): Promise<Note> {
    return this.handleQueue(async () => {
      handleValidateId(id);
      const target = join(this.root, 'Notes', `${id}.md`);
      try { await stat(target); throw new Error('이미 복원된 메모입니다.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(join(this.root, '.wiki/trash', `${id}.md`), target);
      const text = await readFile(target, 'utf8');
      this.fingerprints.set(id, handleHash(text));
      const note = handleDeserialize(text);
      const folders = await this.handleReadFolders();
      if (!folders.includes(note.folder)) await this.handleWriteFolders([...folders, note.folder]);
      return note;
    });
  }

  handleDeletePermanently(id: string): Promise<void> {
    return this.handleQueue(async () => {
      handleValidateId(id);
      const path = join(this.root, '.wiki/trash', `${id}.md`);
      const note = handleDeserialize(await readFile(path, 'utf8'));
      if (note.id !== id) throw new Error('문서 ID가 일치하지 않습니다.');
      await rm(join(this.root, '.wiki/history', id), { recursive: true, force: true });
      for (const name of await readdir(join(this.root, '.wiki/results'))) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const resultPath = join(this.root, '.wiki/results', name);
        const result = JSON.parse(await readFile(resultPath, 'utf8'));
        if (result.noteId === id) await unlink(resultPath);
      }
      await unlink(path);
      this.fingerprints.delete(id);
    });
  }

  async handleHistory(id: string): Promise<Note[]> {
    const directory = join(this.root, '.wiki/history', handleValidateId(id));
    let names: string[];
    try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const notes = await Promise.all(names.filter(name => name.endsWith('.md')).map(async name => handleDeserialize(await readFile(join(directory, name), 'utf8'))));
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40);
  }

  async handleImport(path: string): Promise<Note> {
    if ((await stat(path)).size > MAX_BODY) throw new Error('2MB 이하의 Markdown 파일만 가져올 수 있습니다.');
    let body = await readFile(path, 'utf8');
    let title = basename(path).replace(/\.md$/i, '');
    const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (match) {
      const meta = parseYaml(match[1], { maxAliasCount: 20 });
      if (typeof meta?.title === 'string') title = meta.title;
      // 이 앱의 메타데이터만 제거하며 외부 frontmatter는 원문으로 보존합니다.
      if (meta?.wiki_id) body = match[2];
    }
    return this.handleCreate(title, body, '가져온 메모');
  }

  async handleExport(destination: string) {
    await mkdir(destination, { recursive: true });
    const names = new Set<string>();
    for (const note of await this.handleList()) {
      let name = note.title.replace(/[\\/:*?"<>|#\[\]]/g, '-').replace(/^\.+/, '').trim() || '메모';
      if (names.has(name.toLocaleLowerCase())) name += `-${note.id.slice(0, 8)}`;
      names.add(name.toLocaleLowerCase());
      await writeFile(join(destination, `${name}.md`), handleSerialize(note), { flag: 'wx' });
    }
    await cp(join(this.root, 'Attachments'), join(destination, 'Attachments'), { recursive: true, errorOnExist: true, force: false });
    await cp(join(this.root, '.wiki'), join(destination, '.wiki'), { recursive: true, errorOnExist: true, force: false });
  }

  async handleAddAttachment(source: string, filename: string) {
    if (!/^[a-f0-9-]{36}\.png$/.test(filename)) throw new Error('첨부 파일 이름이 올바르지 않습니다.');
    await copyFile(source, join(this.root, 'Attachments', filename));
    return `Attachments/${filename}`;
  }
}
