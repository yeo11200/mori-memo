import { spawn } from 'node:child_process';
process.env.MORI_COMMERCIAL_BUILD = '1';
const child = spawn('npm', ['run', 'build'], { stdio: 'inherit', env: process.env, shell: false });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
