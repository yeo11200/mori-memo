import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { APIKeyStore } from '../electron/openai/api-key-store';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('OpenAI API key store', () => {
  it('stores only encrypted bytes and deletes an empty key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mori-key-test-')); roots.push(root);
    const store = new APIKeyStore(join(root, 'key'), {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`encrypted:${value}`).reverse(),
      decryptString: value => Buffer.from(value).reverse().toString().slice('encrypted:'.length)
    });
    await store.handleSet('sk-private');
    expect(await store.handleGet()).toBe('sk-private');
    expect((await readFile(join(root, 'key'))).toString()).not.toContain('sk-private');
    await store.handleSet('');
    expect(await store.handleGet()).toBeNull();
  });
  it('reports a corrupt key as configured without blocking bootstrap callers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mori-key-test-')); roots.push(root);
    const path = join(root, 'key');
    await import('node:fs/promises').then(fs => fs.writeFile(path, 'corrupt'));
    const store = new APIKeyStore(path, { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: () => { throw new Error('corrupt'); } });
    expect(await store.handleStatus()).toEqual({ configured: true, warning: '저장된 OpenAI API 키를 확인하지 못했습니다. 설정에서 다시 입력해 주세요.' });
  });
});
