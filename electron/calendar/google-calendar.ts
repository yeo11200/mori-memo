import { createHash } from 'node:crypto';
import type { CalendarBatch, CalendarChoice, CalendarEvent, CalendarState } from '../../shared/calendar';
import { handleLocalDate } from '../../shared/daily';
import type { Note } from '../../shared/types';
import type { CalendarStore } from './secure-store';
import { GOOGLE_SCOPES, handleGoogleAuthorization, handleReadGoogleClient } from './oauth';
import type { GoogleClient, OAuthCode } from './oauth';

export interface GoogleCalendarData {
  client?: GoogleClient;
  token?: { access: string; refresh: string; expiresAt: number };
  accountKey?: string;
  calendars: CalendarChoice[];
  selectedIds: string[];
  autoSync: boolean;
  lastSync?: string;
}
const handleEmpty = (): GoogleCalendarData => ({ calendars: [], selectedIds: [], autoSync: false });
type Json = Record<string, any>;

export class GoogleCalendarService {
  private working = false;
  private login?: AbortController;
  constructor(
    private readonly store: CalendarStore<GoogleCalendarData>,
    private readonly open: (url: string) => Promise<void>,
    private readonly request: typeof fetch = fetch,
    private readonly authorize: (client: GoogleClient, open: (url: string) => Promise<void>, signal: AbortSignal) => Promise<OAuthCode> = handleGoogleAuthorization,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async handleWork<T>(work: () => Promise<T>): Promise<T> {
    if (this.working) throw new Error('캘린더 연결 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
    this.working = true;
    try { return await work(); } finally { this.working = false; }
  }
  private async handleData() { return await this.store.handleGet() || handleEmpty(); }
  async handleState(): Promise<CalendarState> {
    const data = await this.handleData();
    return { configured: !!data.client, connected: !!data.token, calendars: data.calendars, selectedIds: data.selectedIds, autoSync: data.autoSync, lastSync: data.lastSync };
  }
  handleImportClient(text: string) {
    return this.handleWork(async () => {
      const client = handleReadGoogleClient(text);
      await this.store.handleSet({ ...handleEmpty(), client });
      return this.handleState();
    });
  }
  handleCancel() { this.login?.abort(); }
  private async handleRequest(url: string, options: RequestInit = {}): Promise<Response> {
    try { return await this.request(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) }); }
    catch { throw new Error('Google에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'); }
  }
  private async handleJSON(response: Response): Promise<Json> {
    try {
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
      return result as Json;
    } catch { throw new Error('Google 응답을 읽지 못했습니다. 기존 일정은 그대로 유지됩니다.'); }
  }
  private async handleToken(data: GoogleCalendarData, fields: Record<string, string>) {
    const response = await this.handleRequest('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: data.client!.clientId, client_secret: data.client!.clientSecret, ...fields }),
      signal: this.login?.signal,
    });
    if (!response.ok) throw new Error('Google 인증이 만료되었거나 거부됐습니다. 다시 로그인해 주세요.');
    const value = await this.handleJSON(response);
    if (typeof value.access_token !== 'string' || !value.access_token ||
        typeof value.expires_in !== 'number' || value.expires_in <= 0) throw new Error('Google 인증 응답이 올바르지 않습니다.');
    if (value.scope && !GOOGLE_SCOPES.every(scope => value.scope.split(' ').includes(scope))) throw new Error('캘린더 목록과 일정 읽기 권한을 모두 허용해 주세요.');
    const refresh = value.refresh_token || data.token?.refresh;
    if (typeof refresh !== 'string' || !refresh) throw new Error('계속 연결할 권한을 받지 못했습니다. 다시 로그인해 주세요.');
    data.token = { access: value.access_token, refresh, expiresAt: this.now().getTime() + value.expires_in * 1000 };
  }
  private async handleGet(data: GoogleCalendarData, path: string, parameters: Record<string, string> = {}) {
    if (!data.client || !data.token) throw new Error('설정에서 Google Calendar를 먼저 연결해 주세요.');
    if (data.token.expiresAt < this.now().getTime() + 60_000) {
      await this.handleToken(data, { grant_type: 'refresh_token', refresh_token: data.token.refresh });
      await this.store.handleSet(data);
    }
    const url = new URL('https://www.googleapis.com/calendar/v3/' + path);
    url.search = new URLSearchParams(parameters).toString();
    let response = await this.handleRequest(url.href, { headers: { Authorization: 'Bearer ' + data.token.access } });
    if (response.status === 401) {
      await this.handleToken(data, { grant_type: 'refresh_token', refresh_token: data.token.refresh });
      await this.store.handleSet(data);
      response = await this.handleRequest(url.href, { headers: { Authorization: 'Bearer ' + data.token!.access } });
    }
    if (!response.ok) {
      if (response.status === 401) throw new Error('Google 권한을 확인하지 못했습니다. 다시 로그인해 주세요.');
      if (response.status === 403) throw new Error('캘린더 읽기 권한 또는 Google Calendar API 활성화 상태를 확인해 주세요.');
      if (response.status === 404) throw new Error('선택한 캘린더에 접근할 수 없습니다. 목록을 새로고침하고 다시 선택해 주세요.');
      if (response.status === 429) throw new Error('Google 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
      throw new Error('Google 일정 조회에 실패했습니다. 기존 일정은 그대로 유지됩니다.');
    }
    return this.handleJSON(response);
  }
  private async handlePages(data: GoogleCalendarData, path: string, parameters: Record<string, string>) {
    const items: Json[] = [];
    const seen = new Set<string>();
    let pageToken = '';
    do {
      const page = await this.handleGet(data, path, { ...parameters, ...(pageToken ? { pageToken } : {}) });
      if (page.items !== undefined && !Array.isArray(page.items)) throw new Error('Google 목록 응답이 올바르지 않습니다.');
      items.push(...(page.items || []));
      pageToken = page.nextPageToken || '';
      if (typeof pageToken !== 'string' || (pageToken && seen.has(pageToken)) || items.length > 10_000 || seen.size > 50) throw new Error('일정이 너무 많거나 페이지 응답이 올바르지 않습니다. 선택한 캘린더 수를 줄여 주세요.');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return items;
  }
  private async handleCalendars(data: GoogleCalendarData) {
    const items = await this.handlePages(data, 'users/me/calendarList', { maxResults: '250', minAccessRole: 'reader' });
    return items.filter(item => !item.deleted && typeof item.id === 'string').map(item => ({
      id: item.id as string, name: typeof item.summaryOverride === 'string' ? item.summaryOverride : typeof item.summary === 'string' ? item.summary : item.id,
      primary: item.primary === true,
    }));
  }
  handleConnect() {
    return this.handleWork(async () => {
      const data = await this.handleData();
      if (!data.client) throw new Error('먼저 OAuth 데스크톱 앱 JSON 파일을 선택해 주세요.');
      this.login = new AbortController();
      try {
        const code = await this.authorize(data.client, this.open, this.login.signal);
        const next: GoogleCalendarData = { ...handleEmpty(), client: data.client };
        await this.handleToken(next, { grant_type: 'authorization_code', code: code.code, redirect_uri: code.redirectUri, code_verifier: code.verifier });
        next.calendars = await this.handleCalendars(next);
        const primary = next.calendars.find(calendar => calendar.primary);
        if (!primary) throw new Error('기본 캘린더를 찾지 못했습니다. 캘린더 읽기 권한을 확인해 주세요.');
        next.accountKey = createHash('sha256').update(primary.id).digest('hex');
        if (data.accountKey === next.accountKey) {
          next.selectedIds = data.selectedIds.filter(id => next.calendars.some(calendar => calendar.id === id));
          next.autoSync = data.autoSync; next.lastSync = data.lastSync;
        }
        if (this.login.signal.aborted) throw new Error('Google 연결을 취소했습니다.');
        await this.store.handleSet(next);
        return this.handleState();
      } finally { this.login = undefined; }
    });
  }
  handleRefreshCalendars() {
    return this.handleWork(async () => {
      const data = await this.handleData();
      data.calendars = await this.handleCalendars(data);
      data.selectedIds = data.selectedIds.filter(id => data.calendars.some(calendar => calendar.id === id));
      await this.store.handleSet(data);
      return this.handleState();
    });
  }
  handleSelect(selectedIds: string[], autoSync: boolean) {
    return this.handleWork(async () => {
      const data = await this.handleData();
      if (!data.token) throw new Error('먼저 Google Calendar를 연결해 주세요.');
      if (!Array.isArray(selectedIds) || selectedIds.length > 20 || selectedIds.some(id => !data.calendars.some(calendar => calendar.id === id)) || typeof autoSync !== 'boolean') throw new Error('가져올 캘린더를 20개 이내로 선택해 주세요.');
      data.selectedIds = [...new Set(selectedIds)]; data.autoSync = autoSync;
      await this.store.handleSet(data); return this.handleState();
    });
  }
  handleDisconnect() {
    this.handleCancel();
    return this.handleWork(async () => {
      const data = await this.handleData();
      await this.store.handleSet({ ...handleEmpty(), client: data.client });
      return this.handleState();
    });
  }
  handleSync(apply: (batch: CalendarBatch) => Promise<Note>, automatic = false): Promise<Note | null> {
    return this.handleWork(async () => {
      const data = await this.handleData();
      if (automatic && (!data.autoSync || !data.token || !data.selectedIds.length)) return null;
      if (!data.token || !data.accountKey) throw new Error('Google Calendar를 먼저 연결해 주세요.');
      if (!data.selectedIds.length) throw new Error('설정에서 가져올 캘린더를 선택하고 저장해 주세요.');
      const now = this.now();
      const date = handleLocalDate(now);
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const batch: CalendarBatch = { date, snapshots: [] };
      for (const id of data.selectedIds) {
        const calendar = data.calendars.find(item => item.id === id);
        if (!calendar) throw new Error('캘린더 목록을 새로고침해 주세요.');
        const items = await this.handlePages(data, 'calendars/' + encodeURIComponent(id) + '/events', {
          timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true',
          orderBy: 'startTime', showDeleted: 'false', maxResults: '250',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        const events: CalendarEvent[] = [];
        const seen = new Set<string>();
        for (const item of items) {
          if (item.status === 'cancelled') continue;
          const begins = item.start?.dateTime || item.start?.date;
          const ends = item.end?.dateTime || item.end?.date;
          if (typeof item.id !== 'string' || typeof begins !== 'string' || typeof ends !== 'string' ||
            !Number.isFinite(Date.parse(begins)) || !Number.isFinite(Date.parse(ends))) throw new Error('일정 시간 정보를 읽지 못했습니다. 기존 기록을 유지합니다.');
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          const allDay = !!item.start.date;
          if (allDay && !(begins < handleLocalDate(end) && ends > date)) continue;
          let url: string | undefined;
          try { const link = new URL(item.htmlLink); if (link.protocol === 'https:' && !link.username && !link.password && (link.hostname === 'calendar.google.com' || (link.hostname === 'www.google.com' && link.pathname.startsWith('/calendar/')))) url = link.href.replace(/\(/g, '%28').replace(/\)/g, '%29'); } catch { /* 링크가 없어도 일정은 보관합니다. */ }
          events.push({ id: item.id, title: typeof item.summary === 'string' ? item.summary : '제목 없는 일정', start: begins, end: ends, allDay, url });
        }
        batch.snapshots.push({
          key: createHash('sha256').update(JSON.stringify([data.accountKey, id])).digest('hex'),
          calendarName: calendar.name, events, syncedAt: now.toISOString(),
        });
      }
      if (handleLocalDate(this.now()) !== date) throw new Error('날짜가 바뀌었습니다. 오늘 일정을 다시 가져와 주세요.');
      const note = await apply(batch);
      data.lastSync = this.now().toISOString();
      await this.store.handleSet(data);
      return note;
    });
  }
}
