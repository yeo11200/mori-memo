import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { handlePrepareSharedDocument, handleShareHTML } from '../shared/share-document';
import { DocumentSharing } from '../electron/sharing/sharing-service';
import { SharingService } from '../server/sharing/service';
import { SHARE_MAX_ACTIVE } from '../shared/sharing';
import { MemoryShareStore } from './sharing-fixtures';
import { billingFixture } from './billing-fixtures';
import { handleBillingHTTP } from '../server/billing/http';

const key = (value: string) => createHash('sha256').update(value).digest('hex');
const document = { title: '주간 업무보고', body: '## 성과\n\n- 로그인 개선\n- [x] 검증\n\n|업무|상태|\n|---|---|\n|로그인|완료|' };
describe('standalone sharing documents', () => {
  it('keeps visible Markdown while excluding internal IDs, destinations, attachments and hidden HTML', () => {
    const id = randomUUID();
    const safe = handlePrepareSharedDocument({ title: '보고서', body: document.body + `\n\n[[${id}|근거 기록]]\n[회사 자료](https://internal.example/?token=private)\n![비공개 파일명](Attachments/private.png)\n<!-- hidden-secret -->\n<script>secret-script</script>` });
    expect(safe.body).toContain('근거 기록');
    for (const hidden of [id, 'internal.example', 'token=private', 'Attachments/', '비공개 파일명', 'hidden-secret', 'secret-script']) expect(safe.body).not.toContain(hidden);
    const html = handleShareHTML(safe);
    expect(html).toContain('<table>'); expect(html).toContain('disabled'); expect(html).toContain('로그인 개선');
    expect(html).not.toContain('<script'); expect(html).not.toContain('<img');
  });
  it('is stable when revalidated by the server and makes hostile markup inert', () => {
    for (const body of ['[label](javascript:alert(1))', 'https://example.com/query?a=1&b=2', 'www.example.com', 'hello@example.com', '[[업무/내 메모]]', '본문 <img src="file:///private/a" onerror="alert(1)"> 끝', '```html\n<script>alert(1)</script>\n```', document.body]) {
      const safe = handlePrepareSharedDocument({ title: '</title><script>alert(2)</script>', body });
      expect(handlePrepareSharedDocument(safe)).toEqual(safe);
      const html = handleShareHTML(safe); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).not.toContain('href="javascript:');
    }
    expect(() => handlePrepareSharedDocument({ title: '긴 기록', body: '가'.repeat(100001) })).toThrow('100,000');
  });
  it('exports the confirmed snapshot and requires explicit confirmation before uploading', async () => {
    const calls: unknown[] = [];
    const service = new DocumentSharing(async (_key, input) => { calls.push(input); return null; });
    const source = { title: '선택한 기록', body: '처음 내용' };
    const preview = service.prepare(key('note'), source); source.body = '나중에 수정';
    expect(service.get(preview.id).preview.html).toContain('처음 내용');
    expect(service.get(preview.id).preview.html).not.toContain('나중에 수정');
    expect(() => service.mutate(preview.id, 'create', 0, false)).toThrow('동의');
    expect(calls).toHaveLength(0);
    await service.mutate(preview.id, 'create', 0, true);
    expect(calls[0]).toMatchObject({ document: { body: '처음 내용' } });
  });
});

describe('read-only web sharing', () => {
  const setup = async () => {
    const f = billingFixture(); await f.register(); await f.service.trial(f.user, f.device);
    const store = new MemoryShareStore(); const sharing = new SharingService(store, f.service, f.origin);
    return { ...f, store, sharing };
  };
  it('serves without login, publishes only on explicit update and permanently invalidates old links on revoke', async () => {
    const f = await setup(); const source = key('note');
    const first = await f.sharing.mutate(f.user, source, 'create', 0, document, f.device);
    const page = await f.sharing.page(first.url.split('/s/')[1]);
    expect(page.status).toBe(200); expect(page.headers.get('Cache-Control')).toBe('no-store'); expect(page.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(await page.text()).not.toContain(f.user);
    const duplicate = await f.sharing.mutate(f.user, source, 'create', 0, { ...document, body: '새 초안' }, f.device);
    expect(duplicate.digest).toBe(first.digest); expect(duplicate.url).toBe(first.url);
    const updated = await f.sharing.mutate(f.user, source, 'update', first.revision, { ...document, body: '확인한 업데이트' }, f.device);
    expect(updated.url).toBe(first.url); expect(await (await f.sharing.page(first.url.split('/s/')[1])).text()).toContain('확인한 업데이트');
    await expect(f.sharing.mutate(f.user, source, 'update', first.revision, document, f.device)).rejects.toThrow('conflict');
    const stopped = await f.sharing.mutate(f.user, source, 'revoke', updated.revision);
    expect((await f.sharing.page(first.url.split('/s/')[1])).status).toBe(404);
    expect((await f.store.owner(f.user, source))!.body).toBe('');
    const again = await f.sharing.mutate(f.user, source, 'create', stopped.revision, document, f.device);
    expect(again.url).not.toBe(first.url); expect((await f.sharing.page(first.url.split('/s/')[1])).status).toBe(404);
  });
  it('isolates owners, caps active links and allows stopping after Pro expires', async () => {
    const f = await setup();
    for (let i = 0; i < SHARE_MAX_ACTIVE; i++) await f.sharing.mutate(f.user, key('note' + i), 'create', 0, document, f.device);
    await expect(f.sharing.mutate(f.user, key('extra'), 'create', 0, document, f.device)).rejects.toThrow('limit');
    const other = randomUUID(); await f.service.ensure(other, 'other@example.com');
    expect(await f.sharing.owner(other, key('note0'))).toBeNull();
    expect(await f.sharing.list(other)).toEqual([]);
    await expect(f.sharing.mutate(other, key('note0'), 'revoke', 1)).rejects.toThrow();
    f.advance(15 * 86400000);
    await expect(f.sharing.mutate(f.user, key('note0'), 'update', 1, document, f.device)).rejects.toThrow('Pro');
    expect(await f.sharing.list(f.user)).toHaveLength(SHARE_MAX_ACTIVE);
    const existing = await f.sharing.owner(f.user, key('note0'));
    expect((await f.sharing.page(existing!.url.split('/s/')[1])).status).toBe(200);
    await f.sharing.mutate(f.user, key('note0'), 'revoke', existing!.revision);
    expect((await f.sharing.page(existing!.url.split('/s/')[1])).status).toBe(404);
  });
  it('serves public pages through the API without a session but rejects author operations without auth', async () => {
    const f = await setup(); const info = await f.sharing.mutate(f.user, key('note'), 'create', 0, document, f.device);
    const handle = handleBillingHTTP(f.service, { origin: f.origin, supabaseURL: 'https://auth.example.com', anonKey: 'public', tossClientKey: 'test_ck_fixture', cronSecret: 'fixture-cron-secret-for-tests-only', termsURL: f.origin, privacyURL: f.origin, sharing: f.sharing });
    expect((await handle(new Request(info.url))).status).toBe(200);
    expect((await handle(new Request(f.origin + '/shares/source/' + key('note')))).status).toBe(401);
    expect((await handle(new Request(f.origin + '/s/guess'))).status).toBe(404);
  });
});
