import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIRunner, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, handleDiscoverExecutable } from '../electron/cli/cli-runner';

const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(body: string) {
  const dir = await mkdtemp(join(tmpdir(), 'wiki-cli-test-'));
  directories.push(dir);
  const executablePath = join(dir, 'fixture');
  await writeFile(executablePath, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  return { dir, executablePath };
}
const request = { instruction: 'Summarize', content: 'A note' };

describe('CLIRunner', () => {
  it('passes literal input via stdin, isolates cwd, removes unsafe environment and cleans up', async () => {
    const script = await fixture(`let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>console.log(JSON.stringify({input,args:process.argv.slice(2),cwd:process.cwd(),unsafe:[process.env.NODE_OPTIONS,process.env.ELECTRON_RUN_AS_NODE]})));`);
    vi.stubEnv('NODE_OPTIONS', '--trace-warnings');
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    const marker = join(script.dir, 'must-not-exist');
    const content = `$(touch ${marker}); \`touch ${marker}\` & 한글`;
    const output = JSON.parse(await new CLIRunner().handleRun({ ...request, content }, { ...script, provider: 'claude' }));
    expect(output.input).toContain(content);
    expect(output.args.join(' ')).not.toContain(content);
    expect(output.args).toContain('--safe-mode');
    expect(output.args[output.args.indexOf('--tools') + 1]).toBe('');
    expect(output.unsafe).toEqual([null, null]);
    expect(output.cwd).not.toBe(process.cwd());
    await expect(access(output.cwd)).rejects.toThrow();
    await expect(access(marker)).rejects.toThrow();
  });
  it('reads only Codex final message and uses read-only sandbox with no default model', async () => {
    const script = await fixture(`const fs=require('node:fs');const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify(a));console.log('not final output');`);
    const args = JSON.parse(await new CLIRunner().handleRun(request, { ...script, provider: 'codex' }));
    expect(args).toContain('read-only');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ephemeral');
    expect(args).not.toContain('--model');
  });
  it.each([['process.exit(3)', /code 3/], ['console.log("  ")', /empty/i]])('rejects unsuccessful or empty response %s', async (body, error) => {
    const script = await fixture(body);
    await expect(new CLIRunner().handleRun(request, { ...script, provider: 'claude' })).rejects.toThrow(error);
  });
  it('does not expose echoed private text in error diagnostics', async () => {
    const script = await fixture(`process.stderr.write('SECRET NOTE');process.exit(7)`);
    const failure = await new CLIRunner().handleRun(request, { ...script, provider: 'claude' }).catch(error => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('code 7');
    expect((failure as Error).message).not.toContain('SECRET NOTE');
  });
  it('rejects excessive input and missing executables', async () => {
    const runner = new CLIRunner();
    await expect(runner.handleRun({ ...request, content: 'x'.repeat(MAX_INPUT_BYTES + 1) }, { executablePath: '/absent', provider: 'claude' })).rejects.toThrow(/input/i);
    await expect(runner.handleRun(request, { executablePath: '/absent', provider: 'claude' })).rejects.toThrow(/executable/i);
  });
  it('bounds streamed stdout and stderr', async () => {
    for (const stream of ['stdout', 'stderr']) {
      const script = await fixture(`process.${stream}.write('x'.repeat(${MAX_OUTPUT_BYTES + 1}));setInterval(()=>{},1000)`);
      await expect(new CLIRunner().handleRun(request, { ...script, provider: 'claude' })).rejects.toThrow(/output.*limit/i);
    }
  });
  it('bounds the Codex output file', async () => {
    const script = await fixture(`const a=process.argv;require('node:fs').writeFileSync(a[a.indexOf('--output-last-message')+1],'x'.repeat(${MAX_OUTPUT_BYTES + 1}));`);
    await expect(new CLIRunner().handleRun(request, { ...script, provider: 'codex' })).rejects.toThrow(/output.*limit/i);
  });
  it('times out and kills a SIGTERM-resistant process before cleanup', async () => {
    const script = await fixture(`process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`);
    await expect(new CLIRunner().handleRun(request, { ...script, provider: 'claude', timeoutMs: 1000 })).rejects.toThrow(/timed out/i);
  });
  it('cancels immediately and permits reuse', async () => {
    const script = await fixture(`process.stdin.resume();process.stdin.on('end',()=>console.log('done'));`);
    const runner = new CLIRunner();
    const pending = runner.handleRun(request, { ...script, provider: 'claude' });
    runner.handleCancel();
    await expect(pending).rejects.toThrow(/cancel/i);
    await expect(runner.handleRun(request, { ...script, provider: 'claude' })).resolves.toBe('done');
  });
  it('rejects overlapping requests and cancels a running child', async () => {
    const script = await fixture(`require('node:fs').writeFileSync(process.argv.includes('--model')?process.argv[process.argv.indexOf('--model')+1]:'/dev/null',process.cwd());setInterval(()=>{},1000)`);
    const marker = join(script.dir, 'started');
    const runner = new CLIRunner();
    const pending = runner.handleRun(request, { ...script, provider: 'claude', model: marker });
    const rejected = pending.catch(error => error as Error);
    await expect(runner.handleRun(request, { ...script, provider: 'claude' })).rejects.toThrow(/already/i);
    await expect.poll(async () => readFile(marker, 'utf8').catch(() => '')).not.toBe('');
    const cwd = await readFile(marker, 'utf8');
    runner.handleCancel();
    expect((await rejected as Error).message).toMatch(/cancel/i);
    await expect(access(cwd)).rejects.toThrow();
  });
  it('keeps the temporary directory until the terminating child closes', async () => {
    const script = await fixture(`const fs=require('node:fs');const marker=process.argv[process.argv.indexOf('--model')+1];process.on('SIGTERM',()=>{fs.writeFileSync(marker,JSON.stringify({exists:fs.existsSync(process.cwd()),cwd:process.cwd()}));setTimeout(()=>process.exit(0),75)});fs.writeFileSync(marker,'ready');setInterval(()=>{},1000)`);
    const marker = join(script.dir, 'state');
    const runner = new CLIRunner();
    const outcome = runner.handleRun(request, { ...script, provider: 'claude', model: marker }).catch(error => error as Error);
    await expect.poll(async () => readFile(marker, 'utf8').catch(() => '')).toBe('ready');
    runner.handleCancel();
    expect((await outcome as Error).message).toMatch(/cancel/i);
    const state = JSON.parse(await readFile(marker, 'utf8'));
    expect(state.exists).toBe(true);
    await expect(access(state.cwd)).rejects.toThrow();
  });
  it('discovers a standard home installation without starting a shell', async () => {
    const script = await fixture(`throw new Error('Discovery must not execute the CLI')`);
    const bin = join(script.dir, '.local/bin');
    await mkdir(bin, { recursive: true });
    await copyFile(script.executablePath, join(bin, 'codex'));
    vi.stubEnv('HOME', script.dir);
    expect(handleDiscoverExecutable('codex')).toBe(join(bin, 'codex'));
  });
});
