import { build } from 'esbuild';
await build({ entryPoints: ['server/billing/server.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, outfile: 'dist-billing/server.mjs' });
