import { createHash } from 'node:crypto';
import type { CalendarStore } from '../calendar/secure-store';
import { WORK_PROVIDERS, WORK_LABELS, type WorkCredentials, type WorkProvider, type WorkSelection, type WorkState, type WorkItem, type WorkBatch } from '../../shared/work';
import { handleLocalDate } from '../../shared/daily';
import { handleWorkLink } from '../../shared/work-link';
import type { Note } from '../../shared/types';

interface Connection { token: string; email?: string; site?: string; accountId: string; state: WorkState }
export type WorkData = Partial<Record<WorkProvider, Connection>>;
const handleDefaults = (provider: WorkProvider): WorkState => ({ provider, connected: false, projects: [], allProjects: true, projectIds: [], state: 'open', autoSync: false });
const handleProvider = (provider: WorkProvider) => {
  if (!WORK_PROVIDERS.includes(provider)) throw new Error('지원하지 않는 업무 서비스입니다.');
};
const handleId = (value: unknown) => {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[a-zA-Z0-9-]+$/.test(String(value))) throw new Error('업무 응답의 식별자가 올바르지 않습니다.');
  return String(value);
};
const handleText = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('업무 응답 형식이 올바르지 않습니다.');
  return value;
};

/** 인증정보는 메인 프로세스의 암호화 저장소에서만 사용합니다. */
export class WorkService {
  private busy = false;
  constructor(private readonly store: CalendarStore<WorkData>, private readonly request: typeof fetch = fetch) {}
  private async handleWork<T>(work: () => Promise<T>) {
    if (this.busy) throw new Error('다른 업무 연결 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }
  async handleState(provider: WorkProvider): Promise<WorkState> {
    handleProvider(provider);
    return (await this.store.handleGet())?.[provider]?.state || handleDefaults(provider);
  }
  handleConnect(input: WorkCredentials) {
    return this.handleWork(async () => {
      if (!input || typeof input !== 'object') throw new Error('연결 정보를 입력해 주세요.');
      handleProvider(input.provider);
      if (typeof input.token !== 'string' || !input.token.trim() || input.token.length > 8192 || /[\r\n]/.test(input.token)) throw new Error('유효한 액세스 토큰을 입력해 주세요.');
      const connection: Connection = { token: input.token.trim(), accountId: '', state: handleDefaults(input.provider) };
      if (input.provider === 'jira') {
        let site: URL;
        try { site = new URL(input.site || ''); } catch { throw new Error('Jira Cloud 사이트 주소를 입력해 주세요.'); }
        if (site.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(site.hostname) || site.port || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error('https://회사.atlassian.net 형식의 Jira Cloud 주소가 필요합니다.');
        if (typeof input.email !== 'string' || !/^[^\s:]+@[^\s:]+$/.test(input.email) || input.email.length > 320) throw new Error('Jira 계정 이메일을 입력해 주세요.');
        connection.site = site.origin; connection.email = input.email;
      }
      const { data: profile } = await this.handleRequest(connection, input.provider, input.provider === 'jira' ? '/rest/api/3/myself' : input.provider === 'github' ? '/user' : '/api/v4/user');
      const accountId = profile.accountId ?? profile.id;
      if ((typeof accountId !== 'string' && typeof accountId !== 'number') || !String(accountId).trim() || String(accountId).length > 256) throw new Error('계정 식별자를 확인하지 못했습니다.');
      connection.accountId = String(accountId);
      connection.state = { ...connection.state, connected: true, site: connection.site, account: handleText(profile.displayName ?? profile.login ?? profile.username) };
      const stored = await this.store.handleGet() || {};
      const previous = stored[input.provider];
      if (previous?.accountId === connection.accountId && previous.site === connection.site) connection.state = { ...previous.state, account: connection.state.account, connected: true };
      const items = await this.handleItems(connection, input.provider);
      connection.state.projects = this.handleProjects(items, connection.state);
      stored[input.provider] = connection;
      await this.store.handleSet(stored);
      return connection.state;
    });
  }
  handleDisconnect(provider: WorkProvider) {
    return this.handleWork(async () => {
      handleProvider(provider);
      const data = await this.store.handleGet() || {};
      delete data[provider]; await this.store.handleSet(data);
      return handleDefaults(provider);
    });
  }
  handleSelect(provider: WorkProvider, selection: WorkSelection) {
    return this.handleWork(async () => {
      handleProvider(provider);
      if (!selection || typeof selection.allProjects !== 'boolean' || typeof selection.autoSync !== 'boolean' || !['open', 'all'].includes(selection.state) || !Array.isArray(selection.projectIds) || selection.projectIds.length > 10000 || selection.projectIds.some(id => typeof id !== 'string')) throw new Error('업무 필터가 올바르지 않습니다.');
      const data = await this.store.handleGet() || {};
      const connection = data[provider];
      if (!connection) throw new Error('먼저 계정을 연결해 주세요.');
      if (selection.projectIds.some(id => !connection.state.projects.some(project => project.id === id))) throw new Error('프로젝트 목록을 새로고침해 주세요.');
      connection.state = { ...connection.state, allProjects: selection.allProjects, autoSync: selection.autoSync, state: selection.state, projectIds: [...new Set(selection.projectIds)] };
      await this.store.handleSet(data); return connection.state;
    });
  }
  handleRefresh(provider: WorkProvider) {
    return this.handleWork(async () => {
      handleProvider(provider);
      const data = await this.store.handleGet() || {};
      const connection = data[provider];
      if (!connection) throw new Error('먼저 계정을 연결해 주세요.');
      connection.state.projects = this.handleProjects(await this.handleItems(connection, provider), connection.state);
      await this.store.handleSet(data); return connection.state;
    });
  }
  handleSync(provider: WorkProvider, apply: (batch: WorkBatch) => Promise<Note>, automatic = false) {
    return this.handleWork(async () => {
      handleProvider(provider);
      const data = await this.store.handleGet() || {};
      const connection = data[provider];
      if (automatic && (!connection || !connection.state.autoSync)) return null;
      if (!connection) throw new Error('먼저 계정을 연결해 주세요.');
      const date = handleLocalDate();
      const items = await this.handleItems(connection, provider);
      const syncedAt = new Date().toISOString();
      const selected = connection.state.allProjects ? items : items.filter(item => connection.state.projectIds.includes(item.projectId));
      const key = createHash('sha256').update([provider, connection.site || '', connection.accountId].join(':')).digest('hex');
      const note = await apply({ date, key, provider, account: connection.state.account!, items: selected, syncedAt });
      connection.state.projects = this.handleProjects(items, connection.state);
      connection.state.lastSync = syncedAt;
      await this.store.handleSet(data);
      return note;
    });
  }
  private handleProjects(items: WorkItem[], state: WorkState) {
    const projects = new Map(state.projects.map(project => [project.id, project]));
    for (const item of items) projects.set(item.projectId, { id: item.projectId, name: item.projectName });
    return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  private async handleRequest(connection: Connection, provider: WorkProvider, path: string) {
    const origin = provider === 'jira' ? connection.site! : provider === 'github' ? 'https://api.github.com' : 'https://gitlab.com';
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error('업무 API 주소가 올바르지 않습니다.');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (provider === 'jira') headers.Authorization = 'Basic ' + Buffer.from(connection.email + ':' + connection.token).toString('base64');
    else if (provider === 'github') { headers.Accept = 'application/vnd.github+json'; headers.Authorization = 'Bearer ' + connection.token; headers['X-GitHub-Api-Version'] = '2022-11-28'; }
    else headers['PRIVATE-TOKEN'] = connection.token;
    let response: Response;
    try { response = await this.request(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error(WORK_LABELS[provider] + '에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.'); }
    if (!response.ok) {
      const reason = response.status === 401 ? '인증에 실패했습니다. 토큰을 확인해 주세요.' : response.status === 403 ? '접근 권한 또는 호출 한도를 확인해 주세요.' : response.status === 429 ? '호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.' : '업무 조회에 실패했습니다. (' + response.status + ')';
      throw new Error(WORK_LABELS[provider] + ' ' + reason);
    }
    try { return { data: await response.json(), headers: response.headers }; }
    catch { throw new Error('업무 API 응답을 읽지 못했습니다.'); }
  }
  private async handleItems(connection: Connection, provider: WorkProvider): Promise<WorkItem[]> {
    const items = new Map<string, WorkItem>();
    let cursor = '';
    const cursors = new Set<string>();
    for (let page = 1; page <= 100; page++) {
      const params = new URLSearchParams({ per_page: '100', page: String(page), state: connection.state.state === 'all' ? 'all' : provider === 'gitlab' ? 'opened' : 'open' });
      let path: string;
      if (provider === 'jira') {
        const jira = new URLSearchParams({ jql: 'assignee = currentUser()' + (connection.state.state === 'open' ? ' AND statusCategory != Done' : '') + ' ORDER BY updated DESC', fields: 'summary,status,project,duedate', maxResults: '100' });
        if (cursor) jira.set('nextPageToken', cursor);
        path = '/rest/api/3/search/jql?' + jira;
      } else {
        params.set(provider === 'github' ? 'filter' : 'scope', provider === 'github' ? 'assigned' : 'assigned_to_me');
        path = (provider === 'github' ? '/issues?' : '/api/v4/issues?') + params;
      }
      const { data, headers } = await this.handleRequest(connection, provider, path);
      const rows = provider === 'jira' ? data.issues : data;
      if (!Array.isArray(rows)) throw new Error('업무 목록 응답이 올바르지 않습니다.');
      for (const row of rows) {
        if (provider === 'github' && row.pull_request) continue;
        const id = handleId(row.id);
        let item: WorkItem;
        if (provider === 'jira') {
          item = { id, title: handleText(row.fields?.summary), projectId: handleId(row.fields?.project?.id), projectName: handleText(row.fields?.project?.name), status: handleText(row.fields?.status?.name), url: connection.site + '/browse/' + handleText(row.key), dueDate: row.fields?.duedate || undefined };
        } else if (provider === 'github') {
          item = { id, title: handleText(row.title), projectId: handleId(row.repository?.id), projectName: handleText(row.repository?.full_name), status: handleText(row.state), url: handleText(row.html_url) };
        } else {
          const url = handleText(row.web_url);
          item = { id, title: handleText(row.title), projectId: handleId(row.project_id), projectName: new URL(url).pathname.split('/-/issues/')[0].slice(1), status: handleText(row.state), url, dueDate: row.due_date || undefined };
        }
        if (!handleWorkLink(item.url) || (provider === 'jira' && new URL(item.url).origin !== connection.site) || (provider !== 'jira' && new URL(item.url).hostname !== provider + '.com')) throw new Error('업무의 원본 링크가 올바르지 않습니다.');
        if (item.dueDate && (typeof item.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate))) throw new Error('업무 기한 형식이 올바르지 않습니다.');
        items.set(id, item);
      }
      if (provider === 'jira') {
        if (data.isLast === true) return [...items.values()];
        if (typeof data.nextPageToken !== 'string' || !data.nextPageToken || cursors.has(data.nextPageToken)) throw new Error('업무 페이지를 끝까지 확인하지 못했습니다. 기존 기록은 유지합니다.');
        cursor = data.nextPageToken; cursors.add(cursor);
      } else if (provider === 'github') {
        const link = headers.get('link');
        if (!link?.includes('rel="next"') && rows.length < 100) return [...items.values()];
        if (link && !link.includes('rel="next"')) return [...items.values()];
      } else {
        const next = headers.get('x-next-page');
        if (next === '' || (next === null && rows.length < 100)) return [...items.values()];
        if (next !== null && next !== String(page + 1)) throw new Error('업무 페이지 정보가 올바르지 않습니다.');
      }
    }
    throw new Error('업무가 조회 한도 10,000건을 넘었습니다. 기존 기록은 유지합니다.');
  }
}
