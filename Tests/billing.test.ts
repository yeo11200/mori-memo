import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BILLING_POLICY, PRO_AMOUNT, handleNextBillingMonth } from '../shared/billing';
import { handleVerifyGrant } from '../electron/billing/receipts';
import { BillingClient, type LocalBilling } from '../electron/billing/billing-client';
import { RemoteError, TossGateway } from '../server/billing/adapters';
import { handleBillingHTTP } from '../server/billing/http';
import { billingFixture } from './billing-fixtures';

const purchase = async (fixture: ReturnType<typeof billingFixture>) => {
  const { service, user, device, store } = fixture;
  const checkout = await service.checkout(user, randomUUID(), device, BILLING_POLICY, 'purchase');
  await service.callback(user, checkout.id, new URL(checkout.url).searchParams.get('token')!, (await store.get(user)).customerKey, 'auth-fixture');
  return checkout;
};
describe('monthly Pro billing', () => {
  it('preserves KST month-end anchor through February and leap years', () => {
    const january = '2026-01-31T01:00:00.000Z';
    expect(handleNextBillingMonth(january, 31)).toBe('2026-02-28T01:00:00.000Z');
    expect(handleNextBillingMonth('2026-02-28T01:00:00.000Z', 31)).toBe('2026-03-31T01:00:00.000Z');
    expect(handleNextBillingMonth('2024-01-31T15:00:00.000Z')).toBe('2024-02-29T15:00:00.000Z');
    expect(() => handleNextBillingMonth(january, 32)).toThrow();
  });
  it('starts one trial across racing requests and caps devices transactionally', async () => {
    const f = billingFixture(); await f.register();
    const trials = await Promise.allSettled([f.service.trial(f.user, f.device), f.service.trial(f.user, f.device)]);
    expect(trials.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const end = (await f.store.get(f.user)).trialEnd;
    expect(Date.parse(end!) - f.clock()).toBe(14 * 86400000);
    const devices = await Promise.allSettled([f.service.register(f.user, randomUUID(), '두 번째'), f.service.register(f.user, randomUUID(), '세 번째')]);
    expect(devices.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await f.store.get(f.user)).devices).toHaveLength(2);
    await expect(f.service.trial(f.user, f.device)).rejects.toThrow('이미');
    expect((await f.store.get(f.user)).trialEnd).toBe(end);
  });
  it('only activates after a matching approved charge; card callback is consumed once', async () => {
    const f = billingFixture(); await f.register();
    const checkout = await purchase(f);
    expect(f.gateway.calls).toHaveLength(1);
    const account = await f.store.get(f.user);
    expect(account.paidUntil).toBe('2026-02-28T01:00:00.000Z');
    expect(account.billingKey).not.toContain('fixture-billing-key');
    expect((await f.service.entitlements(f.user, f.device)).summary.status).toBe('active');
    await expect(f.service.callback(f.user, checkout.id, new URL(checkout.url).searchParams.get('token')!, account.customerKey, 'auth-fixture')).rejects.toThrow('이미');
    expect(f.gateway.calls).toHaveLength(1);
    await expect(f.service.checkout(f.user, randomUUID(), f.device, BILLING_POLICY, 'purchase')).rejects.toThrow('이미 Pro');
  });
  it('renews once under concurrent workers; cancel retains paid time and prevents next charge', async () => {
    const f = billingFixture(); await f.register(); await purchase(f);
    f.advance(28 * 86400000);
    await Promise.all([f.service.job(), f.service.job(), f.service.job()]);
    expect(f.gateway.payments.size).toBe(2);
    expect((await f.store.get(f.user)).paidUntil).toBe('2026-03-31T01:00:00.000Z');
    await f.service.cancel(f.user);
    expect((await f.service.entitlements(f.user, f.device)).summary.status).toBe('active');
    f.advance(31 * 86400000);
    await f.service.job(); expect(f.gateway.payments.size).toBe(2);
    expect((await f.service.entitlements(f.user, f.device)).receipt).toBeNull();
  });
  it('reconciles a lost success response without creating a new charge', async () => {
    const f = billingFixture(); await f.register();
    f.gateway.afterCharge = async () => { throw new Error('Connection lost AFTER approval'); };
    await purchase(f);
    expect((await f.store.get(f.user)).attempts[0].state).toBe('unknown');
    expect((await f.service.entitlements(f.user, f.device)).receipt).toBeNull();
    f.advance(121000); await f.service.job();
    expect(f.gateway.payments.size).toBe(1); expect(f.gateway.calls).toHaveLength(1);
    expect((await f.service.entitlements(f.user, f.device)).summary.status).toBe('active');
  });
  it('handles declines, amount mismatch, card replacement and refunds without granting unverified time', async () => {
    const f = billingFixture(); await f.register();
    f.gateway.fail = new RemoteError(403, 'INSUFFICIENT_BALANCE');
    await purchase(f); expect((await f.service.entitlements(f.user, f.device)).receipt).toBeNull();
    f.gateway.fail = null; await purchase(f);
    const before = (await f.store.get(f.user)).paidUntil;
    const checkout = await f.service.checkout(f.user, randomUUID(), f.device, BILLING_POLICY, 'update_method');
    await f.service.callback(f.user, checkout.id, new URL(checkout.url).searchParams.get('token')!, (await f.store.get(f.user)).customerKey, 'new-card');
    expect((await f.store.get(f.user)).paidUntil).toBe(before);
    expect(f.gateway.payments.size).toBe(1);
    const paymentKey = (await f.store.get(f.user)).attempts.at(-1)!.paymentKey!;
    await f.service.requestRefund(f.user, (await f.store.get(f.user)).attempts.at(-1)!.id); await f.service.approveRefund(f.user);
    const response = await f.service.entitlements(f.user, f.device);
    expect(response.receipt).toBeNull();
    await f.service.reconcile(f.user, (await f.store.get(f.user)).attempts.at(-1)!.order);
    expect((await f.service.entitlements(f.user, f.device)).receipt).toBeNull();
  });
  it('rejects forged, expired, wrong-device and wrong-account receipts', async () => {
    const f = billingFixture(); await f.register(); await f.service.trial(f.user, f.device);
    const { receipt } = await f.service.entitlements(f.user, f.device);
    const verify = (token: string, user = f.user, device = f.device, now = f.clock()) => handleVerifyGrant(token, { 'test-v1': f.publicPEM }, f.origin, user, device, now);
    expect(verify(receipt!).capabilities).toContain('reports.ai_generate');
    expect(() => verify(receipt!, randomUUID())).toThrow();
    expect(() => verify(receipt!, f.user, randomUUID())).toThrow();
    expect(() => verify(receipt!, f.user, f.device, f.clock() + 7 * 86400000)).toThrow();
    const parts = receipt!.split('.'); parts[1] = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url');
    expect(() => verify(parts.join('.'))).toThrow();
  });
  it('retries a declined renewal at 24/72 hours and never charges an extra manual-purchase cycle', async () => {
    const f = billingFixture(); await f.register(); await purchase(f);
    f.advance(28 * 86400000); f.gateway.fail = new RemoteError(403, 'INSUFFICIENT_BALANCE');
    await f.service.job(); await f.service.job(); expect(f.gateway.calls).toHaveLength(2);
    f.advance(24 * 3600000); await f.service.job(); expect(f.gateway.calls).toHaveLength(3);
    f.advance(48 * 3600000 + 5 * 60000); f.gateway.fail = null; await f.service.job();
    expect(f.gateway.calls).toHaveLength(4); expect(f.gateway.payments.size).toBe(2);
    expect((await f.store.get(f.user)).paidUntil).toBe('2026-03-31T01:00:00.000Z');
  });
  it('pauses automatic renewal during a manual checkout and starts only one new paid period', async () => {
    const f = billingFixture(); await f.register(); await purchase(f); f.advance(29 * 86400000);
    const checkout = await f.service.checkout(f.user, randomUUID(), f.device, BILLING_POLICY, 'purchase');
    await f.service.job(); expect(f.gateway.payments.size).toBe(1);
    await f.service.callback(f.user, checkout.id, new URL(checkout.url).searchParams.get('token')!, (await f.store.get(f.user)).customerKey, 'auth');
    await f.service.job(); expect(f.gateway.payments.size).toBe(2);
    expect((await f.store.get(f.user)).paidUntil).toBe('2026-04-01T01:00:00.000Z');
  });
  it('does not grant a payment with the wrong amount', async () => {
    const f = billingFixture(); await f.register();
    f.gateway.afterCharge = async () => { for (const payment of f.gateway.payments.values()) payment.totalAmount = 1; };
    await purchase(f);
    expect((await f.service.entitlements(f.user, f.device)).receipt).toBeNull();
    expect((await f.store.get(f.user)).attempts[0].state).toBe('unknown');
  });
  it('uses exact KRW 2900 and a stable idempotency key at the payment boundary', async () => {
    let sent: any; let headers: any;
    const gateway = new TossGateway('test_sk_fixture', async (_url, init) => { sent = JSON.parse(init!.body as string); headers = init!.headers; return Response.json({}); });
    const f = billingFixture(); await f.register(); await purchase(f);
    const attempt = (await f.store.get(f.user)).attempts[0];
    await gateway.charge('key', 'customer', attempt);
    expect(sent.amount).toBe(PRO_AMOUNT); expect(sent.amount).toBe(2900);
    expect(headers['Idempotency-Key']).toBe(attempt.key);
  });
});

describe('desktop account isolation and API trust', () => {
  it('keeps beta free, grants offline only with a verified receipt, and clears it on logout', async () => {
    const f = billingFixture(); await f.register(); await f.service.trial(f.user, f.device);
    let saved: LocalBilling | null = { deviceId: f.device, tokens: { access_token: 'access', refresh_token: 'refresh', expires_at: f.clock() / 1000 + 3600, user: { id: f.user, email: 'test@example.com' } }, entitlement: await f.service.entitlements(f.user, f.device), lastSync: f.clock() };
    const store = { handleGet: async () => structuredClone(saved), handleSet: async (value: LocalBilling | null) => { saved = structuredClone(value); } };
    const client = new BillingClient({ enabled: true, url: f.origin, publicKeys: { 'test-v1': f.publicPEM } }, store, async () => {}, async () => { throw new Error('offline'); }, f.clock);
    expect((await client.state(true)).capabilities).toContain('reports.ai_generate');
    await client.logout(); expect((await client.state()).capabilities).toEqual([]);
    const beta = new BillingClient({ enabled: false, url: '', publicKeys: {} }, store, async () => {});
    await expect(beta.require('reports.ai_generate')).resolves.toBeUndefined();
  });
  it('rejects unauthenticated trials, cross-site requests, forged success callbacks and wrong cron secrets', async () => {
    const f = billingFixture(); await f.register();
    const handle = handleBillingHTTP(f.service, { origin: f.origin, supabaseURL: 'https://auth.example.com', anonKey: 'public-fixture', tossClientKey: 'test_ck_fixture', cronSecret: 'test-cron-secret-long-enough-for-tests', termsURL: f.origin + '/terms', privacyURL: f.origin + '/privacy', fetcher: async () => Response.json({ error: 'unauthorized' }, { status: 401 }) });
    expect((await handle(new Request(f.origin + '/trials', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await handle(new Request(f.origin + '/auth/email-code', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }))).status).toBe(403);
    expect((await handle(new Request(f.origin + '/jobs/billing', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }))).status).toBe(401);
    const response = await handle(new Request(f.origin + '/billing/callback?user=' + f.user + '&session=' + randomUUID() + '&nonce=forged&authKey=forged'));
    expect(response.status).toBe(303); expect((await f.service.entitlements(f.user, f.device)).receipt).toBeNull();
    expect((await handle(new Request(f.origin + '/webhooks/toss', { method: 'POST', body: JSON.stringify({ data: { orderId: 'mori-' + randomUUID(), status: 'DONE' } }) }))).status).toBe(200);
    expect(f.gateway.calls).toHaveLength(0);
  });
});
