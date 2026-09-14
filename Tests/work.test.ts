import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../electron/vault/vault';
import { handleWorkLink } from '../shared/work-link';
import { describe, expect, it, vi } from 'vitest';
import { WorkService, type WorkData } from '../electron/work/work-service';
import { handleWorkMerge } from '../shared/work-merge';
import { handleDailyTasks, handleLocalDate } from '../shared/daily';
import type { WorkBatch, WorkProvider } from '../shared/work';

const item = { id: '1', title: '구현', projectId: '10', projectName: 'team/app', url: 'https://github.com/team/app/issues/1', status: 'open' };
const batch = (): WorkBatch => ({ date: handleLocalDate(), key: 'a'.repeat(64), provider: 'github', account: 'me', items: [item], syncedAt: new Date().toISOString() });
const handleFixture = (provider: WorkProvider, respond?: (url: URL) => Response) => {
  let data: WorkData = {};
  const request = vi.fn(async (url: string | URL | Request) => {
    const target = new URL(String(url));
    if (respond) return respond(target);
    if (/\/(user|myself)$/.test(target.pathname)) return Response.json({ id: 1, accountId: '712020:account-uuid', login: 'me', username: 'me', displayName: 'me' });
    if (provider === 'github') return Response.json([{ id: 1, number: 1, title: '구현', state: 'open', html_url: item.url, repository: { id: 10, full_name: 'team/app' } }]);
    if (provider === 'gitlab') return Response.json([{ id: 1, iid: 1, title: '구현', state: 'opened', web_url: 'https://gitlab.com/team/app/-/issues/1', project_id: 10 }]);
    return Response.json({ issues: [{ id: '1', key: 'APP-1', fields: { summary: '구현', status: { name: '진행 중' }, project: { id: '10', name: '앱' }, duedate: '2026-09-14' } }], isLast: true });
  });
  const store = { handleGet: async () => structuredClone(data), handleSet: async (next: WorkData) => { data = structuredClone(next); } };
  const service = new WorkService(store, request as typeof fetch);
  const handleConnect = () => service.handleConnect({ provider, token: 'test-secret', email: 'me@example.com', site: 'https://demo.atlassian.net' });
  return { service, handleConnect, store, request };
};

describe('work connectors', () => {
  it.each(['jira', 'github', 'gitlab'] as const)('%s imports assigned work without exposing credentials', async provider => {
    const { service, handleConnect, request, store } = handleFixture(provider);
    const state = await handleConnect();
    expect(state.connected).toBe(true);
    expect(state.projects).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain('secret');
    await service.handleSelect(provider, { allProjects: false, projectIds: ['10'], state: 'open', autoSync: true });
    let result: WorkBatch | undefined;
    await service.handleSync(provider, async value => { result = value; return {} as any; });
    expect(result?.items.map(value => value.title)).toEqual(['구현']);
    const urls = request.mock.calls.map(([url]) => String(url)).join(' ');
    expect(urls).toContain(provider === 'jira' ? 'search/jql' : 'issues');
    await service.handleDisconnect(provider);
    expect((await service.handleState(provider)).connected).toBe(false);
    expect(JSON.stringify(await store.handleGet())).not.toContain('test-secret');
  });
  it('keeps existing account if replacement authentication fails', async () => {
    const { service, handleConnect, request } = handleFixture('github');
    await handleConnect();
    request.mockImplementationOnce(async () => new Response('', { status: 401 }));
    await expect(handleConnect()).rejects.toThrow('인증');
    expect((await service.handleState('github')).connected).toBe(true);
  });
  it('does not commit on a failed later page', async () => {
    const { service, handleConnect, request } = handleFixture('github');
    await handleConnect();
    request.mockImplementationOnce(async () => Response.json([], { headers: { link: '<https://api.github.com/issues?page=2>; rel="next"' } }));
    request.mockImplementationOnce(async () => new Response('', { status: 503 }));
    const apply = vi.fn();
    await expect(service.handleSync('github', apply)).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
  });
  it('rejects untrusted Jira hosts before sending token', async () => {
    const { service, request } = handleFixture('jira');
    await expect(service.handleConnect({ provider: 'jira', token: 'secret', email: 'me@example.com', site: 'https://evil.example' })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('skips automatic sync unless enabled and filters selected projects', async () => {
    const { service, handleConnect } = handleFixture('github');
    await handleConnect();
    const apply = vi.fn(async (_batch: WorkBatch) => ({} as any));
    expect(await service.handleSync('github', apply, true)).toBeNull();
    await service.handleSelect('github', { allProjects: false, projectIds: [], state: 'all', autoSync: false });
    await service.handleSync('github', apply);
    expect(apply.mock.calls[0][0].items).toEqual([]);
  });
});

describe('work daily merge', () => {
  it('updates remote text once while retaining local completion and personal writing', () => {
    const first = handleWorkMerge('개인 기록\n', [], batch());
    const checked = first.body.replace('- [ ]', '- [x]');
    const incoming = batch(); incoming.items[0] = { ...item, title: '수정', status: 'closed' };
    const next = handleWorkMerge(checked, first.snapshots, incoming);
    expect(next.body).toContain('개인 기록');
    expect(next.body).toContain('- [x]');
    expect(next.body).toContain('수정');
    expect(next.body).toContain('closed');
    expect(next.body.match(/mori-work-item:/g)).toHaveLength(1);
    expect(handleDailyTasks(next.body, true)).toEqual([]);
  });
  it('rejects manual body edits but keeps missing source items', () => {
    const first = handleWorkMerge('', [], batch());
    expect(() => handleWorkMerge(first.body.replace('구현', '나의 수정'), first.snapshots, batch())).toThrow('직접 수정');
    const next = handleWorkMerge(first.body, first.snapshots, { ...batch(), items: [] });
    expect(next.body).toContain('조회 대상에서 제외됨');
    expect(next.body).toContain('구현');
  });
  it('rejects duplicate markers and unclosed code blocks', () => {
    const first = handleWorkMerge('', [], batch());
    expect(() => handleWorkMerge(first.body + first.body, first.snapshots, batch())).toThrow();
    expect(() => handleWorkMerge('```\ncode', [], batch())).toThrow();
  });
});


describe('work integration boundaries', () => {
  it('persists provenance after restart and rejects stale revisions without losing checkbox edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mori-work-vault-'));
    try {
      const vault = new Vault(root); await vault.handleInitialize();
      const first = await vault.handleWorkApply(batch());
      const edited = await vault.handleSave({ ...first, title: '나의 하루', folder: '업무', body: first.body.replace('- [ ]', '- [x]') + '\n개인 기록' });
      const reopened = new Vault(root); await reopened.handleInitialize();
      const next = await reopened.handleWorkApply(batch());
      expect(next.id).toBe(first.id);
      expect(next.title).toBe('나의 하루');
      expect(next.folder).toBe('업무');
      expect(next.body).toContain('- [x]');
      expect(next.body).toContain('개인 기록');
      expect(next.workSnapshots).toHaveLength(1);
      expect(await reopened.handleList()).toHaveLength(1);
      await expect(reopened.handleSave({ ...edited, body: 'stale edit' })).rejects.toThrow();
      await expect(reopened.handleWorkApply({ ...batch(), date: '2000-01-01' })).rejects.toThrow('날짜');
      expect((await reopened.handleGet(next.id)).body).toBe(next.body);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(['jira', 'gitlab'] as const)('%s consumes subsequent pages before applying', async provider => {
    const { service, handleConnect, request } = handleFixture(provider);
    await handleConnect();
    if (provider === 'jira') {
      request.mockImplementationOnce(async () => Response.json({ issues: [], nextPageToken: 'second', isLast: false }));
      request.mockImplementationOnce(async () => Response.json({ issues: [], isLast: true }));
    } else {
      request.mockImplementationOnce(async () => Response.json([], { headers: { 'x-next-page': '2' } }));
      request.mockImplementationOnce(async () => Response.json([], { headers: { 'x-next-page': '' } }));
    }
    const apply = vi.fn(async (_batch: WorkBatch) => ({} as any));
    await service.handleSync(provider, apply);
    expect(apply).toHaveBeenCalledTimes(1);
    const finalURL = String(request.mock.calls.at(-1)![0]);
    expect(finalURL).toContain(provider === 'jira' ? 'nextPageToken=second' : 'page=2');
  });
  it('rejects Jira pagination cycles without applying', async () => {
    const { service, handleConnect, request } = handleFixture('jira');
    await handleConnect();
    request.mockImplementation(async () => Response.json({ issues: [], nextPageToken: 'same', isLast: false }));
    const apply = vi.fn();
    await expect(service.handleSync('jira', apply)).rejects.toThrow('페이지');
    expect(apply).not.toHaveBeenCalled();
  });
  it('uses GET with redirect refusal and never sends credentials to a pagination URL', async () => {
    const { service, handleConnect, request } = handleFixture('github');
    await handleConnect();
    request.mockImplementationOnce(async () => Response.json([], { headers: { link: '<https://evil.example/steal>; rel="next"' } }));
    await service.handleSync('github', async () => ({} as any));
    expect(request.mock.calls.every(([url]) => new URL(String(url)).hostname === 'api.github.com')).toBe(true);
    const calls = request.mock.calls as unknown as [URL, RequestInit][];
    for (const [, options] of calls) { expect(options.redirect).toBe('error'); expect(options.method || 'GET').toBe('GET'); }
  });
  it('does not mix changed accounts or source status with local completion', () => {
    const first = handleWorkMerge('', [], batch());
    const other = handleWorkMerge(first.body.replace('- [ ]', '- [x]'), first.snapshots, { ...batch(), key: 'b'.repeat(64), account: 'other' });
    expect(other.snapshots).toHaveLength(2);
    expect(other.body).toContain('- [x]');
    expect(other.body).toContain('- [ ]');
  });
  it('accepts only supported issue links', () => {
    expect(handleWorkLink('https://demo.atlassian.net/browse/APP-1')).toBe(true);
    expect(handleWorkLink('https://gitlab.com/team/sub/app/-/issues/1')).toBe(true);
    for (const value of ['http://github.com/team/app/issues/1', 'https://evil.example/issues/1', 'https://demo.atlassian.net.evil.example/browse/APP-1', 'https://me:secret@github.com/team/app/issues/1', 'https://github.com/team/app/issues/1?q=bad', 'https://github.com/team/app/pull/1']) expect(handleWorkLink(value)).toBe(false);
  });
});
