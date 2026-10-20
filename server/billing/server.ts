import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { SecretBox, SupabaseBillingStore, TossGateway } from './adapters';
import { BillingService } from './service';
import { handleBillingHTTP } from './http';

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing configuration: ${name}`); return value; };
const httpsURL = (name: string) => { const value = new URL(required(name)); if (value.protocol !== 'https:' || value.username || value.password) throw new Error(`HTTPS required: ${name}`); return value.href.replace(/\/$/, ''); };
const origin = httpsURL('BILLING_PUBLIC_URL');
if (new URL(origin).pathname !== '/') throw new Error('BILLING_PUBLIC_URL must be an origin.');
const supabaseURL = httpsURL('SUPABASE_URL');
const secret = required('TOSS_SECRET_KEY'); const client = required('TOSS_CLIENT_KEY');
const live = process.env.BILLING_ALLOW_LIVE === '1';
if (!(live ? secret.startsWith('live_sk_') && client.startsWith('live_ck_') : secret.startsWith('test_sk_') && client.startsWith('test_ck_'))) throw new Error('Payment key mode mismatch. Live mode is opt-in.');
const privateKey = readFileSync(required('BILLING_SIGNING_KEY_PATH'), 'utf8');
if (createPrivateKey(privateKey).asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 signing key required.');
const cronSecret = required('BILLING_CRON_SECRET'); if (cronSecret.length < 32) throw new Error('Cron secret too short.');
const store = new SupabaseBillingStore(supabaseURL, required('SUPABASE_SERVICE_ROLE_KEY'));
const service = new BillingService(store, new TossGateway(secret), { origin, privateKey, kid: required('BILLING_KEY_ID'), box: new SecretBox(required('BILLING_ENCRYPTION_KEY')) });
const handle = handleBillingHTTP(service, { origin, supabaseURL, anonKey: required('SUPABASE_ANON_KEY'), tossClientKey: client, cronSecret, termsURL: httpsURL('BILLING_TERMS_URL'), privacyURL: httpsURL('BILLING_PRIVACY_URL') });
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 16000) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(key, value);
    const url = new URL(request.url || '/', origin);
    // Do not trust Host or forwarded headers from unauthenticated peers.
    if (url.origin !== origin) { response.writeHead(400); response.end(); return; }
    const body = Buffer.concat(chunks);
    const result = await handle(new Request(url, { method: request.method, headers, ...(body.length ? { body } : {}) }), request.socket.remoteAddress);
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end('{"error":"Server request failed"}'); }
});
server.requestTimeout = 90000;
server.headersTimeout = 15000;
server.listen(Number(process.env.BILLING_PORT || 4180), process.env.BILLING_HOST || '127.0.0.1', () => console.log('MORI billing API listening'));
