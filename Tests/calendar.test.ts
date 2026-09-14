import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { GoogleCalendarService, type GoogleCalendarData } from '../electron/calendar/google-calendar';
import { CalendarSecureStore } from '../electron/calendar/secure-store';
import { GOOGLE_SCOPES, handleGoogleAuthorization, handleReadGoogleClient } from '../electron/calendar/oauth';
import { handleCalendarMerge } from '../shared/calendar-merge';
import { handleLocalDate } from '../shared/daily';
import { Vault } from '../electron/vault/vault';
import type { CalendarBatch } from '../shared/calendar';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const clientJSON = JSON.stringify({ installed: { client_id: 'demo.apps.googleusercontent.com', client_secret: 'test-client-secret' } });
const event = { id: 'event-1', summary: '배포 회의', start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date(Date.now() + 3600000).toISOString() }, htmlLink: 'https://www.google.com/calendar/event?eid=demo' };
const handleFixture = (respond?: (url: URL, options?: RequestInit) => Response) => {
  let saved: GoogleCalendarData | null = null;
  const store = { handleGet: async () => structuredClone(saved), handleSet: async (value: GoogleCalendarData) => { saved = structuredClone(value); } };
  const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const target = new URL(String(url));
    if (respond) return respond(target, options);
    if (target.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, scope: GOOGLE_SCOPES.join(' ') });
    if (target.pathname.endsWith('/calendarList')) return Response.json({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true }] });
    return Response.json({ items: [event] });
  });
  const service = new GoogleCalendarService(store, async () => {}, request as typeof fetch, async () => ({ code: 'code', verifier: 'verifier', redirectUri: 'http://127.0.0.1:1234/oauth2callback' }));
  const handleConnect = async () => { await service.handleImportClient(clientJSON); await service.handleConnect(); await service.handleSelect(['me@example.com'], true); };
  return { service, store, request, handleConnect };
};
const handleBatch = (): CalendarBatch => ({ date: handleLocalDate(), snapshots: [{
  key: 'a'.repeat(64), calendarName: '업무', syncedAt: new Date().toISOString(),
  events: [{ id: 'event-1', title: '회의', start: event.start.dateTime, end: event.end.dateTime, allDay: false }],
}] });

describe('Google Calendar', () => {
  it('accepts only desktop client JSON', () => {
    expect(handleReadGoogleClient(clientJSON).clientId).toContain('apps.googleusercontent.com');
    expect(() => handleReadGoogleClient('{}')).toThrow('데스크톱');
    expect(() => handleReadGoogleClient(clientJSON.replace('installed', 'web'))).toThrow('데스크톱');
    expect(() => handleReadGoogleClient('bad')).toThrow('JSON');
  });
  it('exposes no credentials to renderer and imports a selected calendar', async () => {
    const { service, handleConnect, request } = handleFixture();
    await handleConnect();
    const state = await service.handleState();
    expect(JSON.stringify(state)).not.toContain('secret');
    let batch: CalendarBatch | undefined;
    await service.handleSync(async value => { batch = value; return {} as any; });
    expect(batch?.snapshots[0].events[0].title).toBe('배포 회의');
    const call = request.mock.calls.find(([url]) => String(url).includes('/events'))!;
    const url = new URL(String(call[0]));
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.has('timeMin')).toBe(true);
    expect(url.searchParams.has('timeMax')).toBe(true);
    expect((await service.handleState()).lastSync).toBeTruthy();
  });
  it('refreshes expired tokens and keeps existing refresh token if omitted', async () => {
    const fixture = handleFixture();
    await fixture.handleConnect();
    const data = (await fixture.store.handleGet())!;
    data.token!.expiresAt = 0;
    await fixture.store.handleSet(data);
    await fixture.service.handleSync(async () => ({} as any));
    expect(fixture.request.mock.calls.filter(([url]) => String(url).includes('/token'))).toHaveLength(2);
  });
  it('reads every event page before applying and ignores cancelled events', async () => {
    const fixture = handleFixture(url => {
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [{ id: 'me@example.com', primary: true }] });
      return url.searchParams.has('pageToken') ? Response.json({ items: [{ ...event, id: 'second' }, { id: 'deleted', status: 'cancelled' }] }) : Response.json({ items: [event], nextPageToken: 'page-2' });
    });
    await fixture.handleConnect();
    await fixture.service.handleSync(async batch => { expect(batch.snapshots[0].events).toHaveLength(2); return {} as any; });
  });
  it('does not apply partial results or update lastSync after an API failure', async () => {
    let fail = false;
    const fixture = handleFixture(url => {
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [{ id: 'me@example.com', primary: true }] });
      return fail ? Response.json({}, { status: 403 }) : Response.json({ items: [event] });
    });
    await fixture.handleConnect(); fail = true;
    const apply = vi.fn();
    await expect(fixture.service.handleSync(apply)).rejects.toThrow('권한');
    expect(apply).not.toHaveBeenCalled();
    expect((await fixture.service.handleState()).lastSync).toBeUndefined();
  });
  it('honors automatic opt-out, rejects unknown calendars and disconnects locally', async () => {
    const fixture = handleFixture();
    expect(await fixture.service.handleSync(vi.fn(), true)).toBeNull();
    await fixture.handleConnect();
    await expect(fixture.service.handleSelect(['unknown'], true)).rejects.toThrow('선택');
    await fixture.service.handleSelect(['me@example.com'], false);
    expect(await fixture.service.handleSync(vi.fn(), true)).toBeNull();
    await fixture.service.handleDisconnect();
    expect((await fixture.store.handleGet())?.token).toBeUndefined();
    expect((await fixture.service.handleState()).configured).toBe(true);
  });
  it('rejects cancelled auth without saving a connected state', async () => {
    const fixture = handleFixture();
    const service = new GoogleCalendarService(fixture.store, async () => {}, fixture.request as typeof fetch, async () => { throw new Error('취소'); });
    await service.handleImportClient(clientJSON);
    await expect(service.handleConnect()).rejects.toThrow('취소');
    expect((await service.handleState()).connected).toBe(false);
  });
  it('preserves user writing, updates instead of duplicating, and keeps missing events', () => {
    const batch = handleBatch();
    const first = handleCalendarMerge('내 기록', [], batch);
    const secondBatch = structuredClone(batch);
    secondBatch.snapshots[0].events[0].title = '변경된 회의';
    const second = handleCalendarMerge(first.body + '\n내가 쓴 후기', first.snapshots, secondBatch);
    expect(second.body).toContain('내 기록');
    expect(second.body).toContain('내가 쓴 후기');
    expect(second.body.split('변경된 회의')).toHaveLength(2);
    const missing = structuredClone(batch); missing.snapshots[0].events = [];
    const third = handleCalendarMerge(second.body, second.snapshots, missing);
    expect(third.body).toContain('오늘 일정에서 제외됨');
    expect(third.snapshots[0].events).toHaveLength(1);
    expect(() => handleCalendarMerge(first.body.replace('회의', '직접 수정'), first.snapshots, batch)).toThrow('직접 수정');
  });
  it('persists snapshots across restart with history and rejects a different date', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mori-calendar-vault-')); roots.push(root);
    const vault = new Vault(root); await vault.handleInitialize();
    const batch = handleBatch();
    const note = await vault.handleCalendarApply(batch);
    const second = new Vault(root); await second.handleInitialize();
    const again = await second.handleCalendarApply(batch);
    expect(again.id).toBe(note.id);
    expect(again.calendarSnapshots).toHaveLength(1);
    expect(again.body.split('<!-- mori-calendar:')).toHaveLength(3);
    expect((await second.handleHistory(note.id)).length).toBeGreaterThan(0);
    await expect(second.handleCalendarApply({ ...batch, date: '2000-01-01' })).rejects.toThrow('날짜');
  });
  it('encrypts the stored JSON and refuses insecure storage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mori-calendar-store-')); roots.push(root);
    const path = join(root, 'secure.bin');
    const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(Buffer.from(value).toString('base64')), decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString() };
    const store = new CalendarSecureStore<{ token: string }>(path, storage);
    await store.handleSet({ token: 'secret-token' });
    expect((await readFile(path, 'utf8'))).not.toContain('secret-token');
    expect((await store.handleGet())?.token).toBe('secret-token');
    const unsafe = new CalendarSecureStore(path, { ...storage, isEncryptionAvailable: () => false });
    await expect(unsafe.handleSet({})).rejects.toThrow('안전한');
  });
  it('uses state and PKCE on a random loopback port, rejecting wrong state', async () => {
    let auth: URL | undefined;
    const code = await handleGoogleAuthorization(handleReadGoogleClient(clientJSON), async value => {
      auth = new URL(value);
      const callback = new URL(auth.searchParams.get('redirect_uri')!);
      expect(callback.hostname).toBe('127.0.0.1');
      expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
      callback.search = new URLSearchParams({ state: 'wrong', code: 'test-code' }).toString();
      expect((await fetch(callback)).status).toBe(400);
      callback.search = new URLSearchParams({ state: auth.searchParams.get('state')!, code: 'test-code' }).toString();
      await fetch(callback);
    }, new AbortController().signal);
    expect(code.code).toBe('test-code');
    expect(createHash('sha256').update(code.verifier).digest('base64url')).toBe(auth!.searchParams.get('code_challenge'));
  });
  it('closes a pending login on timeout', async () => {
    await expect(handleGoogleAuthorization(handleReadGoogleClient(clientJSON), async () => {}, new AbortController().signal, 20)).rejects.toThrow('로그인 시간');
  });
});
