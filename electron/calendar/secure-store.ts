import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SafeStorageLike } from '../openai/api-key-store';

export interface CalendarStore<T> { handleGet(): Promise<T | null>; handleSet(value: T): Promise<void> }

/** 토큰과 클라이언트 정보를 보관함 밖에 암호화해서 저장합니다. */
export class CalendarSecureStore<T> implements CalendarStore<T> {
  constructor(private readonly path: string, private readonly storage: SafeStorageLike) {}
  async handleGet(): Promise<T | null> {
    let data: Buffer;
    try { data = await readFile(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('외부 연결 정보를 읽지 못했습니다.'); }
    if (!this.storage.isEncryptionAvailable()) throw new Error('안전한 외부 연결 저장소를 사용할 수 없습니다.');
    try { return JSON.parse(this.storage.decryptString(data)); }
    catch { throw new Error('외부 연결 정보를 해독하지 못했습니다.'); }
  }
  async handleSet(value: T) {
    if (!this.storage.isEncryptionAvailable()) throw new Error('안전한 외부 연결 저장소를 사용할 수 없습니다.');
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, this.storage.encryptString(JSON.stringify(value)), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
