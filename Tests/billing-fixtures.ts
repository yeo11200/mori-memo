import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { handleNewAccount, type BillingAccount, type BillingStore, type Attempt } from '../server/billing/model';
import { SecretBox, handleNextWork, type Gateway, type Payment } from '../server/billing/adapters';
import { BillingService } from '../server/billing/service';

export class MemoryBillingStore implements BillingStore {
  accounts = new Map<string, BillingAccount>();
  constructor(public now: () => number) {}
  async get(id: string, email?: string) {
    if (!this.accounts.has(id) && email) this.accounts.set(id, handleNewAccount(id, email));
    const account = this.accounts.get(id); if (!account) throw new Error('Account missing');
    return structuredClone(account);
  }
  async compareAndSwap(account: BillingAccount, revision: number) {
    if (this.accounts.get(account.id)?.revision !== revision) return false;
    this.accounts.set(account.id, structuredClone(account)); return true;
  }
  async pending(limit: number) { return [...this.accounts.values()].filter(account => { const next = handleNextWork(account, this.now()); return next && Date.parse(next) <= this.now(); }).slice(0, limit).map(account => account.id); }
  async ownerOfOrder(order: string) { return [...this.accounts.values()].find(account => account.attempts.some(attempt => attempt.order === order))?.id || null; }
  private limits = new Map<string, { count: number; end: number }>();
  async rateLimit(key: string, max: number, seconds: number) {
    let bucket = this.limits.get(key); if (!bucket || bucket.end <= this.now()) { bucket = { count: 0, end: this.now() + seconds * 1000 }; this.limits.set(key, bucket); }
    if (++bucket.count > max) throw new Error('Rate limit');
  }
}
export class FakeGateway implements Gateway {
  payments = new Map<string, Payment>(); calls: Attempt[] = []; issues = 0;
  fail: Error | null = null; afterCharge: (() => Promise<void>) | null = null;
  async issue() { this.issues++; return { billingKey: 'fixture-billing-key', card: { number: '****1234' } }; }
  async charge(_key: string, _customer: string, attempt: Attempt) {
    this.calls.push(structuredClone(attempt));
    if (this.fail) throw this.fail;
    const existing = this.payments.get(attempt.order); if (existing) return structuredClone(existing);
    const result = { orderId: attempt.order, paymentKey: 'pay-' + randomUUID(), status: 'DONE', totalAmount: 2900, currency: 'KRW' };
    this.payments.set(attempt.order, result);
    if (this.afterCharge) await this.afterCharge();
    return structuredClone(result);
  }
  async lookup(order: string) { return structuredClone(this.payments.get(order) || null); }
  async refund(key: string) {
    const payment = [...this.payments.values()].find(item => item.paymentKey === key)!;
    payment.status = 'CANCELED'; return structuredClone(payment);
  }
  async remove() {}
}
export const billingFixture = () => {
  let now = Date.parse('2026-01-31T01:00:00Z');
  const clock = () => now; const advance = (milliseconds: number) => { now += milliseconds; };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const store = new MemoryBillingStore(clock); const gateway = new FakeGateway();
  const origin = 'https://billing.example.com';
  const service = new BillingService(store, gateway, { origin, privateKey: privatePEM, kid: 'test-v1', box: new SecretBox(randomBytes(32).toString('base64')), now: clock });
  const user = randomUUID(); const device = randomUUID();
  const register = async () => { await service.ensure(user, 'test@example.com'); await service.register(user, device, '테스트 Mac'); };
  return { service, store, gateway, clock, advance, publicPEM, privatePEM, origin, user, device, register };
};
