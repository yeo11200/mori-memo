import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class APIKeyStore {
  constructor(private readonly path: string, private readonly storage: SafeStorageLike) {}

  async handleSet(value: string): Promise<void> {
    if (typeof value !== 'string' || value.length > 1000 || /[\r\n]/.test(value)) throw new Error('API 키를 확인해 주세요.');
    if (!value) { await rm(this.path, { force: true }); return; }
    if (!this.storage.isEncryptionAvailable()) throw new Error('이 기기에서 안전한 API 키 저장소를 사용할 수 없습니다.');
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, this.storage.encryptString(value), { mode: 0o600 });
    await rename(temporary, this.path);
  }

  async handleGet(): Promise<string | null> {
    let encrypted: Buffer;
    try { encrypted = await readFile(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('저장된 API 키를 읽지 못했습니다.'); }
    if (!this.storage.isEncryptionAvailable()) throw new Error('이 기기에서 저장된 API 키를 해독할 수 없습니다.');
    try { return this.storage.decryptString(encrypted); } catch { throw new Error('저장된 API 키를 해독하지 못했습니다. 다시 입력해 주세요.'); }
  }

  async handleStatus(): Promise<{ configured: boolean; warning?: string }> {
    let encrypted: Buffer;
    try { encrypted = await readFile(this.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { configured: false };
      return { configured: true, warning: '저장된 OpenAI API 키 상태를 확인하지 못했습니다. 설정에서 다시 입력해 주세요.' };
    }
    if (!this.storage.isEncryptionAvailable()) return { configured: true, warning: '저장된 OpenAI API 키를 확인하지 못했습니다. 설정에서 다시 입력해 주세요.' };
    try { this.storage.decryptString(encrypted); return { configured: true }; }
    catch { return { configured: true, warning: '저장된 OpenAI API 키를 확인하지 못했습니다. 설정에서 다시 입력해 주세요.' }; }
  }
}
