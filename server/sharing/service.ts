import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { handlePrepareSharedDocument, handleShareHTML, SHARE_CSP } from '../../shared/share-document';
import { SHARE_MAX_ACTIVE, type ShareRow, type ShareInfo, type ShareOperation, type SharedDocument } from '../../shared/sharing';
import type { BillingService } from '../billing/service';
import { BillingError } from '../billing/service';
import { handleJSONRequest } from '../billing/adapters';

export interface ShareMutation { sourceKey: string; operation: ShareOperation; expectedRevision: number; document?: SharedDocument; digest: string; token: string; id: string }
export interface ShareStore {
  list(userId: string): Promise<ShareRow[]>;
  owner(userId: string, sourceKey: string): Promise<ShareRow | null>;
  public(token: string): Promise<ShareRow | null>;
  mutate(userId: string, input: ShareMutation): Promise<ShareRow>;
}
export const handleShareDigest = (document: SharedDocument) => createHash('sha256').update(JSON.stringify(document)).digest('hex');
export class SharingService {
  constructor(private store: ShareStore, private billing: BillingService, private origin: string) {}
  private sourceKey(key: string) { if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new BillingError('공유 문서를 다시 선택해 주세요.'); }
  private info(row: ShareRow): ShareInfo { return { sourceKey: row.sourceKey, id: row.id, title: row.title, url: row.revoked ? '' : this.origin + '/s/' + row.token, revision: row.revision, digest: row.digest, updatedAt: row.updatedAt, revoked: row.revoked }; }
  async list(user: string) { return (await this.store.list(user)).map(row => this.info(row)); }
  async owner(user: string, key: string) { this.sourceKey(key); const row = await this.store.owner(user, key); return row ? this.info(row) : null; }
  async mutate(user: string, key: string, operation: ShareOperation, expectedRevision: number, document?: SharedDocument, device?: string) {
    this.sourceKey(key);
    if (!['create', 'update', 'revoke'].includes(operation) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new BillingError('공유 상태를 다시 확인해 주세요.');
    if (operation !== 'revoke') {
      const access = await this.billing.entitlements(user, device);
      if (!access.receipt) throw new BillingError('공유 링크 만들기·업데이트는 로그인한 Pro 또는 체험 계정에서 사용할 수 있습니다.', 403);
    }
    const safe = operation === 'revoke' ? undefined : handlePrepareSharedDocument(document!);
    const row = await this.store.mutate(user, { sourceKey: key, operation, expectedRevision, document: safe, digest: safe ? handleShareDigest(safe) : '', token: randomBytes(32).toString('base64url'), id: randomUUID() });
    return this.info(row);
  }
  async page(token: string): Promise<Response> {
    const row = /^[A-Za-z0-9_-]{43}$/.test(token) ? await this.store.public(token) : null;
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': SHARE_CSP, 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
    if (!row || row.revoked) return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><title>공유 문서 없음</title><h1>이 공유 문서를 열 수 없습니다.</h1><p>링크를 확인하거나 작성자에게 문의해 주세요.</p></html>', { status: 404, headers });
    return new Response(handleShareHTML({ title: row.title, body: row.body }), { headers });
  }
}
const fromRow = (row: any): ShareRow => ({ id: row.id, userId: row.user_id, sourceKey: row.source_key, token: row.token, title: row.title, body: row.body, digest: row.digest, revision: row.revision, updatedAt: row.updated_at, revoked: row.revoked });
export class SupabaseShareStore implements ShareStore {
  constructor(private url: string, private key: string, private fetcher: typeof fetch = fetch) {}
  private request(path: string, body?: unknown) { return handleJSONRequest(this.fetcher, this.url + '/rest/v1/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  async list(user: string) { const rows = await this.request('mori_shares?user_id=eq.' + encodeURIComponent(user) + '&revoked=eq.false&select=*&order=updated_at.desc&limit=20'); return rows.map(fromRow); }
  async owner(user: string, key: string) { const rows = await this.request('mori_shares?user_id=eq.' + encodeURIComponent(user) + '&source_key=eq.' + key + '&select=*'); return rows[0] ? fromRow(rows[0]) : null; }
  async public(token: string) { const rows = await this.request('mori_shares?token=eq.' + encodeURIComponent(token) + '&revoked=eq.false&select=*'); return rows[0] ? fromRow(rows[0]) : null; }
  async mutate(user: string, input: ShareMutation) {
    try {
      const rows = await this.request('rpc/mori_share_mutate', { p_user: user, p_source: input.sourceKey, p_operation: input.operation, p_revision: input.expectedRevision, p_id: input.id, p_token: input.token, p_title: input.document?.title || '', p_body: input.document?.body || '', p_digest: input.digest });
      return fromRow(rows[0]);
    } catch (cause) {
      if ((cause as { code?: string }).code === 'P0001') throw new BillingError(`공유 상태가 바뀌었거나 한도에 도달했습니다. 새로 확인해 주세요. 공유 링크는 최대 ${SHARE_MAX_ACTIVE}개입니다.`, 409);
      throw cause;
    }
  }
}
