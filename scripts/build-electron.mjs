import { build } from 'esbuild';

const billingConfig = { enabled: process.env.MORI_COMMERCIAL_BUILD === '1', url: process.env.MORI_BILLING_URL || '', publicKeys: JSON.parse(process.env.MORI_BILLING_PUBLIC_KEYS || '{}') };
if (billingConfig.enabled && (!billingConfig.url.startsWith('https://') || !Object.keys(billingConfig.publicKeys).length)) throw new Error('Commercial builds require an HTTPS billing URL and pinned verification keys.');
await build({ entryPoints: ['electron/main.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: 'dist-electron/main.cjs', external: ['electron'], define: { __MORI_BILLING_CONFIG__: JSON.stringify(billingConfig) } });
await build({ entryPoints: ['electron/preload.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: 'dist-electron/preload.cjs', external: ['electron'] });
