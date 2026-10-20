import { randomUUID } from 'node:crypto';
import { handleNextBillingMonth, type BillingDevice, type BillingSummary } from '../../shared/billing';

export interface Attempt {
  id: string; cycle: string; order: string; key: string; start: string; end: string;
  state: 'pending' | 'unknown' | 'done' | 'failed' | 'refunded';
  number: number; paymentKey?: string; leaseUntil: number; createdAt: string;
}
export interface Checkout { id: string; secretHash: string; secret: string; expires: number; purpose: 'purchase' | 'update_method'; attemptId?: string; canceled?: boolean; state: 'pending' | 'processing' | 'confirmed' | 'failed' | 'unknown'; leaseUntil?: number; billingKey?: string }
export interface BillingAccount {
  id: string; revision: number; email: string; customerKey: string;
  devices: BillingDevice[]; trialStart: string | null; trialEnd: string | null;
  paidUntil: string | null; paidStart: string | null; anchorDay: number | null;
  cancelAtEnd: boolean; blocked: boolean; billingKey: string | null; card: string | null;
  checkout: Checkout | null; attempts: Attempt[]; refundRequest?: { id: string; paymentKey: string; createdAt: string };
}
export const handleNewAccount = (id: string, email: string): BillingAccount => ({ id, revision: 0, email, customerKey: randomUUID(), devices: [], trialStart: null, trialEnd: null, paidUntil: null, paidStart: null, anchorDay: null, cancelAtEnd: false, blocked: false, billingKey: null, card: null, checkout: null, attempts: [] });
export const handleSummary = (account: BillingAccount, now = Date.now()): BillingSummary => {
  const last = account.attempts.at(-1);
  const paid = !account.blocked && !!account.paidUntil && Date.parse(account.paidUntil) > now;
  const trial = !account.blocked && !!account.trialEnd && Date.parse(account.trialEnd) > now;
  return { userId: account.id, email: account.email, devices: account.devices, trialEnd: account.trialEnd, paidUntil: account.paidUntil, cancelAtEnd: account.cancelAtEnd,
    status: paid ? 'active' : trial ? 'trial' : last?.state === 'unknown' || last?.state === 'pending' ? 'unknown' : account.cancelAtEnd ? 'canceled' : last?.state === 'failed' ? 'past_due' : 'free',
    nextChargeAt: account.billingKey && account.paidUntil && !account.cancelAtEnd && !account.blocked ? account.paidUntil : null, card: account.card };
};
export const handleNewAttempt = (account: BillingAccount, now: number, fresh = false): Attempt => {
  const last = account.attempts.at(-1);
  const renewing = !fresh && !!account.paidUntil && now <= Date.parse(account.paidUntil) + 96 * 3600000;
  const start = renewing ? account.paidUntil! : new Date(now).toISOString();
  const cycle = `${account.id}:${start}`;
  const number = last?.cycle === cycle ? last.number + 1 : 1;
  return { id: randomUUID(), cycle, order: 'mori-' + randomUUID(), key: randomUUID(), start, end: handleNextBillingMonth(start, renewing ? account.anchorDay! : undefined), state: 'pending', number, leaseUntil: now + 120000, createdAt: new Date(now).toISOString() };
};
export interface BillingStore {
  get(id: string, email?: string): Promise<BillingAccount>;
  compareAndSwap(account: BillingAccount, previousRevision: number): Promise<boolean>;
  pending(limit: number): Promise<string[]>;
  ownerOfOrder(order: string): Promise<string | null>;
  rateLimit(key: string, max: number, windowSeconds: number): Promise<void>;
}
/** Mutators run again on CAS conflict: no network side effects inside a mutation. */
export const handleMutate = async <T>(store: BillingStore, id: string, mutate: (account: BillingAccount) => T): Promise<T> => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const account = structuredClone(await store.get(id));
    const revision = account.revision;
    const result = mutate(account);
    account.revision++;
    if (await store.compareAndSwap(account, revision)) return result;
  }
  throw new Error('요청이 겹쳤습니다. 잠시 후 다시 시도해 주세요.');
};
