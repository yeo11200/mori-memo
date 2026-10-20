import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { handleNewAccount, type BillingAccount, type BillingStore, type Attempt } from './model';
import { PRO_AMOUNT } from '../../shared/billing';

export class RemoteError extends Error {
  constructor(public status: number, public code: string) { super('외부 서비스 요청을 완료하지 못했습니다.'); }
}
export const handleJSONRequest = async (fetcher: typeof fetch, url: string, init: RequestInit, timeout = 15000): Promise<any> => {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeout), redirect: 'error' });
  const text = await response.text();
  if (text.length > 200000) throw new Error('외부 응답이 너무 큽니다.');
  let data: any;
  try { data = JSON.parse(text || 'null'); } catch { throw new Error('외부 서비스 응답 형식을 확인할 수 없습니다.'); }
  if (!response.ok) throw new RemoteError(response.status, typeof data?.code === 'string' ? data.code : 'request_failed');
  return data;
};
export const handleNextWork = (account: BillingAccount, now = Date.now()): string | null => {
  const last = account.attempts.at(-1);
  if (account.checkout && ['processing', 'unknown'].includes(account.checkout.state) && !account.checkout.attemptId) return new Date(account.checkout.leaseUntil || account.checkout.expires).toISOString();
  if (last && ['pending', 'unknown'].includes(last.state)) return new Date(last.leaseUntil).toISOString();
  if (account.blocked || account.cancelAtEnd || !account.billingKey || !account.paidUntil || now > Date.parse(account.paidUntil) + 96 * 3600000) return null;
  if (last?.state === 'failed' && last.start === account.paidUntil) {
    if (last.number >= 3) return null;
    return new Date(Date.parse(last.start) + (last.number === 1 ? 24 : 72) * 3600000).toISOString();
  }
  return account.paidUntil;
};
export class SupabaseBillingStore implements BillingStore {
  constructor(private url: string, private key: string, private fetcher: typeof fetch = fetch) {}
  private request(path: string, method = 'GET', body?: unknown) {
    return handleJSONRequest(this.fetcher, this.url + '/rest/v1/' + path, { method, headers: { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async get(id: string, email?: string): Promise<BillingAccount> {
    if (email !== undefined) await this.request('rpc/mori_billing_ensure', 'POST', { p_id: id, p_state: handleNewAccount(id, email) });
    const rows = await this.request('mori_billing_accounts?user_id=eq.' + encodeURIComponent(id) + '&select=state');
    if (!rows?.[0]?.state) throw new Error('계정 상태를 찾을 수 없습니다.');
    return rows[0].state;
  }
  async compareAndSwap(account: BillingAccount, revision: number) {
    return await this.request('rpc/mori_billing_cas', 'POST', { p_id: account.id, p_revision: revision, p_state: account, p_next: handleNextWork(account) }) === true;
  }
  async pending(limit: number): Promise<string[]> {
    const rows = await this.request('mori_billing_accounts?next_work_at=lte.' + encodeURIComponent(new Date().toISOString()) + '&order=next_work_at.asc&limit=' + Math.min(limit, 100) + '&select=user_id');
    return rows.map((row: { user_id: string }) => row.user_id);
  }
  async ownerOfOrder(order: string) {
    const rows = await this.request('mori_billing_orders?order_id=eq.' + encodeURIComponent(order) + '&select=user_id');
    return rows[0]?.user_id || null;
  }
  async rateLimit(key: string, max: number, seconds: number) {
    if (await this.request('rpc/mori_billing_rate', 'POST', { p_bucket: key, p_max: max, p_seconds: seconds }) !== true) throw new RemoteError(429, 'rate_limit');
  }
}

export class SecretBox {
  private key: Buffer;
  constructor(key: string) { this.key = Buffer.from(key, 'base64'); if (this.key.length !== 32) throw new Error('32바이트 암호화 키가 필요합니다.'); }
  seal(value: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  open(value: string) {
    const bytes = Buffer.from(value, 'base64'); const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
}
export interface Payment { orderId: string; paymentKey: string; status: string; totalAmount: number; currency: string; approvedAt?: string; card?: { number?: string; issuerCode?: string } }
export interface Gateway {
  issue(authKey: string, customerKey: string): Promise<{ billingKey: string; card?: { number?: string; issuerCode?: string } }>;
  charge(key: string, customer: string, attempt: Attempt): Promise<Payment>;
  lookup(order: string): Promise<Payment | null>;
  refund(payment: string, requestId: string): Promise<Payment>;
  remove(key: string): Promise<void>;
}
export class TossGateway implements Gateway {
  constructor(private key: string, private fetcher: typeof fetch = fetch) {}
  private request(path: string, method = 'GET', body?: unknown, idempotency?: string) {
    return handleJSONRequest(this.fetcher, 'https://api.tosspayments.com/v1/' + path, { method, headers: { Authorization: 'Basic ' + Buffer.from(this.key + ':').toString('base64'), 'Content-Type': 'application/json', ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, 70000);
  }
  issue(authKey: string, customerKey: string) { return this.request('billing/authorizations/issue', 'POST', { authKey, customerKey }); }
  charge(key: string, customerKey: string, attempt: Attempt) { return this.request('billing/' + encodeURIComponent(key), 'POST', { customerKey, amount: PRO_AMOUNT, orderId: attempt.order, orderName: 'MORI Pro 월 구독' }, attempt.key); }
  async lookup(order: string): Promise<Payment | null> {
    try { return await this.request('payments/orders/' + encodeURIComponent(order)); }
    catch (error) { if (error instanceof RemoteError && error.status === 404 && error.code === 'NOT_FOUND_PAYMENT') return null; throw error; }
  }
  refund(payment: string, requestId: string) { return this.request('payments/' + encodeURIComponent(payment) + '/cancel', 'POST', { cancelReason: '고객 환불 요청' }, requestId); }
  async remove(key: string) { await this.request('billing/' + encodeURIComponent(key), 'DELETE'); }
}
