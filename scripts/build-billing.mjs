import { build } from 'esbuild';
await build({ entryPoints: ['server/billing/server.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: 'dist-billing/server.mjs' });
