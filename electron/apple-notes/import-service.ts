import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Vault } from '../vault/vault';
import type { AppleCatalog, AppleImportState, AppleSelection, AppleScan, AppleResult } from '../../shared/apple-notes';
import { handleImportStatus } from './compare';

/** Apple 원본 스냅샷과 연동 선택·검토 결과를 관리합니다. */
export class AppleImportService {
  private catalog?: AppleCatalog;
  private scannedAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private vault: Vault, private readCatalog: () => Promise<AppleCatalog>) {}
  private handleQueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work); this.queue = next.catch(() => undefined); return next;
  }
  async handleState(): Promise<AppleImportState> {
    try {
      const state = JSON.parse(await readFile(join(this.vault.root, '.wiki/apple-imports.json'), 'utf8'));
      if (!state || !Array.isArray(state.folderIds) || !Array.isArray(state.noteIds) || !Array.isArray(state.reviews) || !Array.isArray(state.results)) throw new Error('Apple 연동 기록을 읽지 못했습니다. 보관함 백업을 확인하세요.');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { folderIds: [], noteIds: [], reviews: [], results: [] };
      throw error;
    }
  }
  private async handleSave(state: AppleImportState) {
    const path = join(this.vault.root, '.wiki/apple-imports.json'); const temporary = path + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 }); await rename(temporary, path);
  }
  handleScan(): Promise<AppleScan> {
    return this.handleQueue(async () => {
      this.catalog = undefined; this.scannedAt = 0;
      const catalog = await this.readCatalog();
      this.catalog = catalog; this.scannedAt = Date.now();
      const state = await this.handleState(); const notes = await this.vault.handleList();
      const preview = catalog.notes.map(source => {
        const note = notes.find(note => note.appleSource?.sourceId === source.id);
        return { sourceId: source.id, title: source.title, noteId: note?.id, status: handleImportStatus(source, note), message: source.error };
      });
      return { catalog, state, preview };
    });
  }
  handleSync(selection: AppleSelection): Promise<AppleImportState> {
    return this.handleQueue(async () => {
      if (!this.catalog || Date.now() - this.scannedAt > 300_000) throw new Error('Apple 메모 목록을 새로 읽은 후 실행해 주세요.');
      if (!selection || !['all', 'selected'].includes(selection.mode) || !Array.isArray(selection.folderIds) || !Array.isArray(selection.noteIds) || [...selection.folderIds, ...selection.noteIds].some(id => typeof id !== 'string')) throw new Error('가져올 항목을 선택해 주세요.');
      const state = await this.handleState(); const catalog = this.catalog;
      if (selection.mode === 'selected') {
        if (selection.folderIds.some(id => !catalog.folders.some(folder => folder.id === id)) || selection.noteIds.some(id => !catalog.notes.some(note => note.id === id))) throw new Error('목록에 없는 항목입니다. 목록을 새로 읽어 주세요.');
        state.folderIds = [...new Set([...state.folderIds, ...selection.folderIds])];
        state.noteIds = [...new Set([...state.noteIds, ...selection.noteIds])];
      }
      const folderIds = selection.mode === 'all' ? state.folderIds : selection.folderIds;
      const noteIds = selection.mode === 'all' ? state.noteIds : selection.noteIds;
      const sources = catalog.notes.filter(note => folderIds.includes(note.folderId) || noteIds.includes(note.id));
      state.noteIds = [...new Set([...state.noteIds, ...sources.map(source => source.id)])];
      state.results = [];
      // 메모 본문 저장 전에 선택을 기록하여 중간 종료 후에도 재시도할 수 있습니다.
      await this.handleSave(state);
      for (const source of sources) {
        let result: AppleResult;
        try { result = await this.vault.handleImportApple(source); }
        catch { result = { sourceId: source.id, title: source.title, status: 'failed', message: '저장하지 못했습니다. 메모 상태를 확인한 뒤 다시 시도하세요.' }; }
        if (result.status !== 'failed') state.reviews = state.reviews.filter(review => review.source.id !== source.id);
        if (result.status === 'review' && result.noteId) state.reviews.push({ source, noteId: result.noteId });
        state.results.push(result);
        await this.handleSave(state);
      }
      for (const id of noteIds.filter(id => !catalog.notes.some(note => note.id === id))) {
        state.results.push({ sourceId: id, title: '원본을 찾을 수 없는 메모', status: 'missing', message: '삭제 또는 계정 접근 상태를 확인하세요. MORI 메모는 유지합니다.' });
      }
      state.lastSyncAt = new Date().toISOString(); await this.handleSave(state); return state;
    });
  }
  handleResolve(sourceId: string, choice: 'keep' | 'apple' | 'merge', revision: string, body?: string): Promise<AppleImportState> {
    return this.handleQueue(async () => {
      if (!['keep', 'apple', 'merge'].includes(choice)) throw new Error('검토 방법을 선택해 주세요.');
      const state = await this.handleState(); const review = state.reviews.find(item => item.source.id === sourceId);
      if (!review) throw new Error('검토할 항목을 찾을 수 없습니다.');
      await this.vault.handleImportApple(review.source, choice, revision, body);
      state.reviews = state.reviews.filter(item => item.source.id !== sourceId);
      state.results = state.results.map(result => result.sourceId === sourceId ? { ...result, status: 'updated', message: '검토한 내용을 반영했습니다.' } : result);
      await this.handleSave(state); return state;
    });
  }
}
