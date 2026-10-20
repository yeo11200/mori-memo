import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { billingFixture } from './billing-fixtures';
import { BillingService } from '../server/billing/service';
import { SecretBox } from '../server/billing/adapters';
import { handleBillingHTTP } from '../server/billing/http';

/** Tests only: this module is not a production entry point or authentication bypass. */
export const startBillingFixture = async () => {
  const fixture = billingFixture(); fixture.advance(Date.now() - fixture.clock());
  let handle: ReturnType<typeof handleBillingHTTP>;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    try {
      const result = await handle(new Request('http://127.0.0.1:' + (server.address() as { port: number }).port + req.url, { method: req.method, headers, ...(body.length ? { body } : {}) }));
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer()));
    } catch { res.writeHead(500); res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const service = new BillingService(fixture.store, fixture.gateway, { origin: url, privateKey: fixture.privatePEM, kid: 'test-v1', box: new SecretBox(randomBytes(32).toString('base64')), now: fixture.clock });
  const fakeAuth: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/auth/v1/otp') return Response.json({});
    if (path === '/auth/v1/verify' || path === '/auth/v1/token') {
      if (path.endsWith('verify') && JSON.parse(init!.body as string).token !== '123456') return Response.json({ code: 'otp_expired' }, { status: 401 });
      return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, user: { id: fixture.user, email: 'billing@example.com' } });
    }
    if (path === '/auth/v1/user' && new Headers(init?.headers).get('authorization') === 'Bearer fixture-access') return Response.json({ id: fixture.user, email: 'billing@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' });
    if (path === '/auth/v1/logout') return Response.json({});
    return Response.json({ code: 'unauthorized' }, { status: 401 });
  };
  handle = handleBillingHTTP(service, { origin: url, supabaseURL: 'https://fixture.invalid', anonKey: 'fixture-public-key', tossClientKey: 'test_ck_fixture', cronSecret: 'fixture-cron-secret-for-tests-only', termsURL: url + '/terms', privacyURL: url + '/privacy', fetcher: fakeAuth });
  return { ...fixture, service, server, url, keys: { 'test-v1': fixture.publicPEM }, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
};
