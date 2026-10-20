import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BILLING_POLICY, MAX_DEVICES, OFFLINE_DAYS, PRO_AMOUNT, PRO_CAPABILITIES, TRIAL_DAYS, handleBillingId, type EntitlementResponse } from '../../shared/billing';
import { handleSignGrant } from '../../electron/billing/receipts';
import { handleMutate, handleNewAttempt, handleSummary, type Attempt, type BillingAccount, type BillingStore } from './model';
import { RemoteError, SecretBox, type Gateway, type Payment } from './adapters';

export class BillingError extends Error { constructor(message: string, public status = 400) { super(message); } }
export interface ServiceConfig { origin: string; privateKey: string; kid: string; box: SecretBox; now?: () => number }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class BillingService {
  private now: () => number;
  constructor(public store: BillingStore, private gateway: Gateway, private config: ServiceConfig) { this.now = config.now || Date.now; }
  async ensure(id: string, email: string) {
    const existing = await this.store.get(id, email);
    if (existing.email === email) return;
    return handleMutate(this.store, id, account => { account.email = email; });
  }
  async register(id: string, deviceId: string, name: string) {
    handleBillingId(deviceId);
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new BillingError('기기 이름을 확인해 주세요.');
    await handleMutate(this.store, id, account => {
      const device = account.devices.find(value => value.id === deviceId);
      if (device) { device.lastSeenAt = new Date(this.now()).toISOString(); return; }
      if (account.devices.length >= MAX_DEVICES) throw new BillingError('Mac은 2대까지 등록할 수 있습니다. 이전 기기를 해제해 주세요.', 409);
      account.devices.push({ id: deviceId, name: name.trim(), lastSeenAt: new Date(this.now()).toISOString() });
    });
  }
  async revoke(id: string, deviceId: string) {
    handleBillingId(deviceId);
    await handleMutate(this.store, id, account => { account.devices = account.devices.filter(device => device.id !== deviceId); });
  }
  async trial(id: string, deviceId: string) {
    await handleMutate(this.store, id, account => {
      this.requireDevice(account, deviceId);
      if (account.trialStart || account.paidUntil || account.blocked) throw new BillingError('이 계정의 무료 체험은 이미 사용했습니다.', 409);
      account.trialStart = new Date(this.now()).toISOString();
      account.trialEnd = new Date(this.now() + TRIAL_DAYS * 86400000).toISOString();
    });
    return this.entitlements(id, deviceId);
  }
  async entitlements(id: string, deviceId?: string): Promise<EntitlementResponse> {
    const account = await this.store.get(id); const now = this.now();
    const summary = handleSummary(account, now);
    let receipt: string | null = null;
    if (deviceId && account.devices.some(device => device.id === deviceId) && ['active', 'trial'].includes(summary.status)) {
      const source = summary.status === 'active' ? 'subscription' : 'trial';
      const validUntil = Math.floor(Date.parse(source === 'subscription' ? account.paidUntil! : account.trialEnd!) / 1000);
      const iat = Math.floor(now / 1000);
      receipt = handleSignGrant({ iss: this.config.origin, aud: 'mori-desktop', sub: id, device_id: deviceId, capabilities: PRO_CAPABILITIES, source, valid_until: validUntil, iat, exp: Math.min(iat + OFFLINE_DAYS * 86400, validUntil) }, this.config.privateKey, this.config.kid);
    }
    return { summary, receipt, serverNow: new Date(now).toISOString(), payments: account.attempts.slice(-24).reverse().map(attempt => ({ id: attempt.id, createdAt: attempt.createdAt, amount: PRO_AMOUNT, state: attempt.state, refundRequested: !!attempt.paymentKey && account.refundRequest?.paymentKey === attempt.paymentKey })) };
  }
  private requireDevice(account: BillingAccount, deviceId: string) { if (!account.devices.some(device => device.id === deviceId)) throw new BillingError('이 Mac을 먼저 등록해 주세요.', 403); }
  async checkout(id: string, requestId: string, deviceId: string, policy: string, purpose: 'purchase' | 'update_method') {
    handleBillingId(requestId);
    if (policy !== BILLING_POLICY || !['purchase', 'update_method'].includes(purpose)) throw new BillingError('결제 조건을 다시 확인하고 동의해 주세요.');
    const secret = randomBytes(32).toString('base64url');
    const checkout = await handleMutate(this.store, id, account => {
      this.requireDevice(account, deviceId);
      const previous = account.checkout;
      if (previous && (previous.id === requestId || previous.state === 'pending') && previous.purpose === purpose && previous.expires > this.now()) return previous;
      if (previous && ['processing', 'unknown'].includes(previous.state)) throw new BillingError('이전 결제 결과를 확인 중입니다. 구매 복원을 눌러 주세요.', 409);
      if (purpose === 'purchase' && account.paidUntil && Date.parse(account.paidUntil) > this.now() && !account.blocked) throw new BillingError('이미 Pro 이용 중입니다. 구독 상태를 확인해 주세요.', 409);
      if (purpose === 'update_method' && (!account.paidUntil || account.blocked)) throw new BillingError('변경할 구독을 찾을 수 없습니다.');
      if (account.attempts.some(attempt => ['pending', 'unknown'].includes(attempt.state))) throw new BillingError('결제 확인 중에는 새 결제를 시작할 수 없습니다.', 409);
      if (purpose === 'purchase') account.cancelAtEnd = true;
      account.checkout = { id: requestId, purpose, secret: this.config.box.seal(secret), secretHash: digest(secret), expires: this.now() + 15 * 60000, state: 'pending' };
      return account.checkout;
    });
    return { id: checkout.id, url: `${this.config.origin}/checkout/${id}/${checkout.id}?token=${encodeURIComponent(this.config.box.open(checkout.secret))}` };
  }
  async checkoutPage(id: string, checkoutId: string, secret: string) {
    handleBillingId(id); handleBillingId(checkoutId);
    const account = await this.store.get(id); const checkout = account.checkout;
    if (!checkout || checkout.id !== checkoutId || checkout.secretHash !== digest(secret) || checkout.expires <= this.now() || checkout.state !== 'pending') throw new BillingError('결제 링크가 만료되었거나 이미 처리되었습니다.');
    return { customerKey: account.customerKey, purpose: checkout.purpose };
  }
  async callback(id: string, checkoutId: string, secret: string, customerKey: string, authKey: string) {
    handleBillingId(id); handleBillingId(checkoutId);
    if (typeof authKey !== 'string' || authKey.length < 1 || authKey.length > 400) throw new BillingError('결제 인증을 확인해 주세요.');
    const checkout = await handleMutate(this.store, id, account => {
      const item = account.checkout;
      if (!item || item.id !== checkoutId || item.secretHash !== digest(secret) || account.customerKey !== customerKey || item.expires <= this.now()) throw new BillingError('결제 요청을 확인할 수 없습니다.');
      if (item.state !== 'pending') throw new BillingError('이미 처리한 결제입니다. 앱에서 구매를 복원해 주세요.', 409);
      item.state = 'processing'; item.leaseUntil = this.now() + 120000; return item;
    });
    let issued: Awaited<ReturnType<Gateway['issue']>>;
    try { issued = await this.gateway.issue(authKey, customerKey); }
    catch (error) {
      await handleMutate(this.store, id, account => { if (account.checkout?.id === checkoutId) account.checkout.state = error instanceof RemoteError && error.status < 500 ? 'failed' : 'unknown'; });
      throw new BillingError('카드 등록 결과를 확인하지 못했습니다. 앱에서 구매를 복원해 주세요.', 503);
    }
    if (typeof issued.billingKey !== 'string' || !issued.billingKey) throw new BillingError('카드 등록 결과를 확인하지 못했습니다.', 503);
    const encrypted = this.config.box.seal(issued.billingKey);
    const old = await handleMutate(this.store, id, account => {
      if (account.checkout?.id !== checkoutId || account.checkout.state !== 'processing') throw new BillingError('카드 등록 상태를 다시 확인해 주세요.');
      const old = account.billingKey;
      account.billingKey = encrypted;
      account.card = typeof issued.card?.number === 'string' ? '카드 · ' + issued.card.number.slice(-4).replace(/[^0-9*]/g, '') : '등록된 카드';
      account.checkout.billingKey = encrypted;
      account.checkout.state = checkout.purpose === 'update_method' ? 'confirmed' : 'processing';
      return old;
    });
    // An unused key can safely remain if provider deletion is temporarily unavailable.
    if (old) await this.gateway.remove(this.config.box.open(old)).catch(() => undefined);
    if (checkout.purpose === 'purchase') await this.charge(id, true);
  }
  async charge(id: string, first = false) {
    const now = this.now();
    const attempt = await handleMutate(this.store, id, account => {
      if (!account.billingKey || (!first && (account.blocked || account.cancelAtEnd))) return null;
      const last = account.attempts.at(-1);
      if (last && ['pending', 'unknown'].includes(last.state)) return null;
      if (first && (account.checkout?.state !== 'processing' || account.checkout.canceled)) return null;
      if (!first && account.checkout?.purpose === 'purchase' && (['processing', 'unknown'].includes(account.checkout.state) || (account.checkout.state === 'pending' && account.checkout.expires > now))) return null;
      if (!first && (!account.paidUntil || Date.parse(account.paidUntil) > now || now > Date.parse(account.paidUntil) + 96 * 3600000)) return null;
      if (last?.state === 'failed' && last.start === account.paidUntil && (last.number >= 3 || now < Date.parse(last.start) + (last.number === 1 ? 24 : 72) * 3600000)) return null;
      const next = handleNewAttempt(account, now, first);
      if (first && account.checkout) account.checkout.attemptId = next.id;
      account.attempts.push(next); return next;
    });
    if (!attempt) return;
    const account = await this.store.get(id);
    // A cancellation accepted after reserving but before dispatch prevents this charge.
    if (first ? account.checkout?.canceled : account.cancelAtEnd || account.blocked) {
      await handleMutate(this.store, id, value => { const found = value.attempts.find(item => item.id === attempt.id); if (found?.state === 'pending') found.state = 'failed'; }); return;
    }
    try { await this.applyPayment(id, attempt, await this.gateway.charge(this.config.box.open(account.billingKey!), account.customerKey, attempt)); }
    catch (error) {
      // A definite gateway rejection can be retried later. Timeouts always require reconciliation.
      const definite = error instanceof RemoteError && error.status >= 400 && error.status < 500 && !['IDEMPOTENT_REQUEST_PROCESSING', 'ALREADY_PROCESSED_PAYMENT'].includes(error.code);
      await handleMutate(this.store, id, value => {
        const found = value.attempts.find(item => item.id === attempt.id);
        if (found && found.state !== 'done' && found.state !== 'refunded') { found.state = definite ? 'failed' : 'unknown'; found.leaseUntil = this.now() + 60000; }
        if (first && value.checkout) value.checkout.state = definite ? 'failed' : 'unknown';
      });
    }
  }
  private async applyPayment(id: string, attempt: Attempt, payment: Payment) {
    if (payment.orderId !== attempt.order || payment.totalAmount !== PRO_AMOUNT || payment.currency !== 'KRW' || typeof payment.paymentKey !== 'string' || !payment.paymentKey) throw new BillingError('결제 정보가 주문과 다릅니다.', 502);
    await handleMutate(this.store, id, account => {
      const target = account.attempts.find(value => value.id === attempt.id);
      if (!target || target.state === 'refunded' || (target.state === 'done' && payment.status !== 'CANCELED')) return;
      target.paymentKey = payment.paymentKey;
      if (payment.status === 'DONE') {
        if (target.state === 'done') return;
        target.state = 'done';
        if (!account.paidUntil || Date.parse(attempt.end) > Date.parse(account.paidUntil)) {
          const contiguous = account.paidUntil === attempt.start;
          account.paidStart = attempt.start; account.paidUntil = attempt.end;
          if (!account.anchorDay || !contiguous) account.anchorDay = new Date(Date.parse(attempt.start) + 9 * 3600000).getUTCDate();
        }
        account.blocked = false;
        account.trialEnd = account.trialEnd ? new Date(this.now()).toISOString() : null;
        if (account.checkout?.attemptId === attempt.id) { account.checkout.state = 'confirmed'; if (!account.checkout.canceled) account.cancelAtEnd = false; }
      } else if (payment.status === 'CANCELED') {
        target.state = 'refunded';
        // An old refunded period must not revoke a later separately paid period.
        if (account.paidUntil === attempt.end) { account.blocked = true; account.cancelAtEnd = true; }
      } else { target.state = 'unknown'; target.leaseUntil = this.now() + 60000; }
    });
  }
  async reconcile(id: string, order?: string) {
    const account = await this.store.get(id);
    const candidates = order ? account.attempts.filter(attempt => attempt.order === order) : account.attempts.filter(attempt => ['unknown', 'pending'].includes(attempt.state) && attempt.leaseUntil <= this.now());
    for (const attempt of candidates) {
      const payment = await this.gateway.lookup(attempt.order);
      if (payment) await this.applyPayment(id, attempt, payment);
      else if (this.now() >= Date.parse(attempt.createdAt) + 120000) {
        // A missing transaction is not a decline. Re-dispatch only the SAME idempotent attempt.
        const claimed = await handleMutate(this.store, id, value => {
          const found = value.attempts.find(item => item.id === attempt.id);
          if (!found || !['pending', 'unknown'].includes(found.state) || found.leaseUntil > this.now()) return false;
          if (this.now() - Date.parse(found.createdAt) > 14 * 86400000 || (value.checkout?.attemptId === attempt.id ? value.checkout.canceled : value.cancelAtEnd || value.blocked)) { found.leaseUntil = this.now() + 86400000; return false; }
          found.leaseUntil = this.now() + 120000; return true;
        });
        if (claimed) {
          try { await this.applyPayment(id, attempt, await this.gateway.charge(this.config.box.open(account.billingKey!), account.customerKey, attempt)); }
          catch { /* Persisted pending attempt is retried through reconciliation, never a new order. */ }
        }
      }
    }
  }
  async cancel(id: string, resume = false) {
    await handleMutate(this.store, id, account => {
      if (!account.paidUntil && !account.attempts.some(attempt => ['pending', 'unknown'].includes(attempt.state))) throw new BillingError('변경할 구독이 없습니다.');
      if (resume && (!account.paidUntil || Date.parse(account.paidUntil) <= this.now() || account.blocked || account.attempts.some(attempt => ['pending', 'unknown'].includes(attempt.state)))) throw new BillingError('해지 예약을 취소할 수 없습니다. 새 구독이 필요합니다.');
      account.cancelAtEnd = !resume;
      if (!resume && account.checkout && ['pending', 'processing', 'unknown'].includes(account.checkout.state)) account.checkout.canceled = true;
    });
  }
  async requestRefund(id: string, paymentId: string) {
    handleBillingId(paymentId);
    await handleMutate(this.store, id, account => {
      const paymentKey = account.attempts.find(attempt => attempt.id === paymentId && attempt.state === 'done')?.paymentKey;
      if (!paymentKey) throw new BillingError('환불 요청할 결제를 찾을 수 없습니다.');
      if (account.refundRequest?.paymentKey === paymentKey) return;
      if (account.refundRequest && account.attempts.some(attempt => attempt.paymentKey === account.refundRequest!.paymentKey && attempt.state === 'done')) throw new BillingError('기존 환불 요청을 처리 중입니다. 처리 후 다른 결제를 요청해 주세요.', 409);
      account.refundRequest = { id: randomUUID(), paymentKey, createdAt: new Date(this.now()).toISOString() };
    });
  }
  /** Refund execution is an operator-only decision until the sales refund policy is published. */
  async approveRefund(id: string) {
    const account = await this.store.get(id); const request = account.refundRequest;
    if (!request) throw new BillingError('환불 요청이 없습니다.');
    const attempt = account.attempts.find(value => value.paymentKey === request.paymentKey)!;
    await this.applyPayment(id, attempt, await this.gateway.refund(request.paymentKey, request.id));
  }
  async job() {
    const results: { id: string; ok: boolean }[] = [];
    for (const id of await this.store.pending(100)) {
      try {
        const account = await this.store.get(id);
        const checkout = account.checkout;
        if (checkout && ['processing', 'unknown'].includes(checkout.state) && !checkout.attemptId && (checkout.leaseUntil || 0) <= this.now()) {
          if (checkout.billingKey && checkout.purpose === 'purchase') await this.charge(id, true);
          else await handleMutate(this.store, id, value => { if (value.checkout?.id === checkout.id && !value.checkout.attemptId) value.checkout.state = 'failed'; });
        }
        await this.reconcile(id); await this.charge(id); results.push({ id, ok: true });
      }
      catch { results.push({ id, ok: false }); }
    }
    return results;
  }
}
