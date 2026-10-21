import { randomUUID } from 'node:crypto';
import { BILLING_POLICY, handleBillingEmail, handleBillingId, type AuthTokens, type BillingState, type Capability, type EntitlementResponse } from '../../shared/billing';
import type { CalendarStore } from '../calendar/secure-store';
import { handleVerifyGrant } from './receipts';

export interface BillingConfig { enabled: boolean; url: string; publicKeys: Record<string, string> }
export interface LocalBilling {
  deviceId: string; tokens?: AuthTokens; entitlement?: EntitlementResponse;
  lastSync?: number; lastSeen?: number;
}
class BillingHTTPError extends Error { constructor(message: string, public status: number) { super(message); } }
export class BillingClient {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private config: BillingConfig, private store: CalendarStore<LocalBilling | null>, private open: (url: string) => Promise<void>, private fetcher: typeof fetch = fetch, private now = Date.now) {
    if (config.enabled) {
      const url = new URL(config.url);
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('계정 서버 URL을 확인해 주세요.');
      if (!Object.keys(config.publicKeys).length) throw new Error('Pro 검증 공개키가 필요합니다.');
    }
  }
  private exclusive<T>(work: () => Promise<T>) { const task = this.queue.catch(() => undefined).then(work); this.queue = task; return task; }
  private async local(): Promise<LocalBilling> { return await this.store.handleGet() || { deviceId: randomUUID() }; }
  private async request(path: string, body?: unknown, access?: string, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
    if (!this.config.enabled) throw new Error('현재 버전은 가입 없는 무료 베타입니다.');
    const response = await this.fetcher(this.config.url + path, { method, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: 'Bearer ' + access } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    const text = await response.text();
    if (text.length > 100000) throw new Error('계정 서버 응답이 너무 큽니다.');
    const data = JSON.parse(text);
    if (!response.ok) throw new BillingHTTPError(typeof data?.error === 'string' ? data.error : '계정 연결을 확인해 주세요.', response.status);
    return data;
  }
  private async access(local: LocalBilling): Promise<string> {
    if (!local.tokens) throw new Error('이메일로 로그인해 주세요.');
    if (local.tokens.expires_at <= this.now() / 1000 + 60) {
      try {
        const next = await this.request('/auth/refresh', { refresh_token: local.tokens.refresh_token });
        if (next.user?.id !== local.tokens.user.id) throw new Error('로그인 계정이 바뀌었습니다. 다시 로그인해 주세요.');
        local.tokens = next; await this.store.handleSet(local);
      } catch (cause) {
        if (cause instanceof BillingHTTPError && cause.status === 401) { local.tokens = undefined; local.entitlement = undefined; await this.store.handleSet(local); }
        throw cause;
      }
    }
    return local.tokens!.access_token;
  }
  private async sync(local: LocalBilling, register = false, restore = false) {
    const access = await this.access(local);
    if (register) await this.request('/devices', { id: local.deviceId, name: '나의 Mac' }, access);
    const response: EntitlementResponse = restore
      ? await this.request('/purchase-restore?device=' + local.deviceId, {}, access)
      : await this.request('/entitlements?device=' + local.deviceId, undefined, access);
    if (response.summary?.userId !== local.tokens?.user.id || !Number.isFinite(Date.parse(response.serverNow))) throw new Error('계정 서버 응답을 검증하지 못했습니다.');
    if (response.receipt) handleVerifyGrant(response.receipt, this.config.publicKeys, this.config.url, local.tokens!.user.id, local.deviceId, this.now());
    local.entitlement = response; local.lastSync = this.now(); local.lastSeen = this.now();
    await this.store.handleSet(local);
  }
  private view(local: LocalBilling, offline = false, warning?: string): BillingState {
    let capabilities: Capability[] = [];
    if (local.tokens && local.entitlement?.receipt) {
      try {
        if (local.lastSeen && this.now() < local.lastSeen - 5 * 60000) throw new Error();
        capabilities = handleVerifyGrant(local.entitlement.receipt, this.config.publicKeys, this.config.url, local.tokens.user.id, local.deviceId, this.now()).capabilities;
      } catch { warning ||= '온라인에서 구매를 복원해 Pro 권한을 확인해 주세요.'; }
    }
    return { mode: 'commercial', signedIn: !!local.tokens, email: local.tokens?.user.email, deviceId: local.deviceId, account: local.entitlement?.summary, payments: local.entitlement?.payments, capabilities, offline, warning };
  }
  state(force = false): Promise<BillingState> {
    return this.exclusive(async () => {
      if (!this.config.enabled) return { mode: 'beta', signedIn: false, capabilities: ['reports.ai_generate', 'reports.template_write'], offline: false };
      const local = await this.local();
      if (!local.tokens) return this.view(local);
      if (force || !local.lastSync || this.now() - local.lastSync >= 86400000) {
        try { await this.sync(local); }
        catch (cause) {
          const authFailure = cause instanceof BillingHTTPError && [401, 403].includes(cause.status);
          if (authFailure) { local.tokens = undefined; local.entitlement = undefined; await this.store.handleSet(local); }
          return this.view(local, !authFailure, cause instanceof Error ? cause.message : '계정 서버 연결을 확인해 주세요.');
        }
      }
      local.lastSeen = Math.max(local.lastSeen || 0, this.now()); await this.store.handleSet(local);
      return this.view(local);
    });
  }
  async require(capability: Capability) { if (!(await this.state()).capabilities.includes(capability)) throw new Error('PRO_REQUIRED: 이 기능은 Pro가 필요합니다. 계정 및 Pro에서 무료 체험 또는 월 2,900원 구독을 선택해 주세요.'); }
  async sendCode(email: string) { await this.request('/auth/email-code', { email: handleBillingEmail(email) }); }
  verify(email: string, code: string) {
    return this.exclusive(async () => {
      if (!/^\d{6,10}$/.test(code)) throw new Error('이메일 인증 코드를 확인해 주세요.');
      const tokens: AuthTokens = await this.request('/auth/verify', { email: handleBillingEmail(email), code });
      handleBillingId(tokens.user?.id);
      if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_at)) throw new Error('로그인 응답을 확인하지 못했습니다.');
      const previous = await this.local(); const local: LocalBilling = { deviceId: previous.deviceId, tokens };
      await this.store.handleSet(local); // Never carry another account's receipt into this session.
      await this.sync(local, true); return this.view(local);
    });
  }
  action(action: 'trial' | 'restore' | 'cancel' | 'resume') {
    return this.exclusive(async () => {
      const local = await this.local(); const access = await this.access(local);
      if (action === 'restore') await this.sync(local, true, true);
      else {
        const path = action === 'trial' ? '/trials' : '/subscription/' + action;
        await this.request(path + '?device=' + local.deviceId, action === 'trial' ? { deviceId: local.deviceId, policy: BILLING_POLICY } : {}, access);
        await this.sync(local);
      }
      return this.view(local);
    });
  }
  checkout(purpose: 'purchase' | 'update_method') {
    return this.exclusive(async () => {
      if (!['purchase', 'update_method'].includes(purpose)) throw new Error('구매 종류를 확인해 주세요.');
      const local = await this.local(); const access = await this.access(local);
      const result = await this.request('/checkout-sessions', { deviceId: local.deviceId, requestId: randomUUID(), policy: BILLING_POLICY, purpose }, access);
      const url = new URL(result.url);
      if (url.origin !== new URL(this.config.url).origin || !url.pathname.startsWith('/checkout/') || url.username || url.password) throw new Error('허용되지 않은 결제 URL입니다.');
      await this.open(url.href);
    });
  }
  refund(paymentId: string) {
    return this.exclusive(async () => {
      const local = await this.local();
      await this.request('/refund-requests', { paymentId: handleBillingId(paymentId) }, await this.access(local));
      await this.sync(local); return this.view(local);
    });
  }
  listShares(): Promise<import('../../shared/sharing').ShareInfo[]> {
    return this.exclusive(async () => {
      const local = await this.local();
      return await this.request('/shares', undefined, await this.access(local));
    });
  }
  sharing(sourceKey: string, input?: { operation: 'create' | 'update' | 'revoke'; expectedRevision: number; document?: import('../../shared/sharing').SharedDocument }): Promise<import('../../shared/sharing').ShareInfo | null> {
    return this.exclusive(async () => {
      if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw new Error('공유할 문서를 다시 선택해 주세요.');
      const local = await this.local();
      const method = !input ? 'GET' : input.operation === 'revoke' ? 'DELETE' : 'PUT';
      const result = await this.request('/shares/source/' + sourceKey, input ? { ...input, deviceId: local.deviceId } : undefined, await this.access(local), method);
      if (result?.url) {
        const url = new URL(result.url);
        if (url.origin !== new URL(this.config.url).origin || !/^\/s\/[A-Za-z0-9_-]{43}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error('공유 링크를 검증하지 못했습니다.');
      }
      return result;
    });
  }
  revoke(deviceId: string) {
    return this.exclusive(async () => {
      handleBillingId(deviceId); const local = await this.local();
      await this.request('/devices/' + deviceId, undefined, await this.access(local), 'DELETE');
      await this.sync(local); return this.view(local);
    });
  }
  logout() {
    return this.exclusive(async () => {
      const local = await this.local();
      if (local.tokens) await this.request('/auth/logout', {}, local.tokens.access_token).catch(() => undefined);
      await this.store.handleSet({ deviceId: local.deviceId });
      return this.view({ deviceId: local.deviceId });
    });
  }
}
