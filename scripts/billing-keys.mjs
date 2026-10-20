import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';

for (const path of ['Secrets/billing/signing.pem', 'Secrets/billing/public-keys.json', '.env.billing']) {
  try { await access(path); throw new Error(`Already exists; refusing to overwrite: ${path}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir('Secrets/billing', { recursive: true, mode: 0o700 });
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
await writeFile('Secrets/billing/signing.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const keys = JSON.stringify({ 'mori-v1': publicKey.export({ type: 'spki', format: 'pem' }).toString() });
await writeFile('Secrets/billing/public-keys.json', keys, { mode: 0o600, flag: 'wx' });
const template = await readFile('server/billing/.env.example', 'utf8');
await writeFile('.env.billing', template
  .replace('BILLING_ENCRYPTION_KEY=GENERATED_BY_SETUP_SCRIPT', 'BILLING_ENCRYPTION_KEY=' + randomBytes(32).toString('base64'))
  .replace('BILLING_CRON_SECRET=GENERATED_BY_SETUP_SCRIPT', 'BILLING_CRON_SECRET=' + randomBytes(32).toString('base64url'))
  .replace('MORI_BILLING_PUBLIC_KEYS=GENERATED_BY_SETUP_SCRIPT', "MORI_BILLING_PUBLIC_KEYS='" + keys + "'"), { mode: 0o600, flag: 'wx' });
console.log('Generated signing keys and .env.billing. Fill provider settings before starting the server.');
