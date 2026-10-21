import { createHash, randomUUID } from 'node:crypto';
import type { SharedDocument, ShareInfo, SharePreview } from '../../shared/sharing';
import { handlePrepareSharedDocument, handleShareHTML } from '../../shared/share-document';

export class DocumentSharing {
  private previews = new Map<string, { preview: SharePreview; document: SharedDocument }>();
  constructor(private remote: (key: string, input?: { operation: 'create' | 'update' | 'revoke'; expectedRevision: number; document?: SharedDocument }) => Promise<ShareInfo | null>) {}
  prepare(sourceKey: string, input: SharedDocument): SharePreview {
    const document = handlePrepareSharedDocument(input);
    const preview = { id: randomUUID(), sourceKey, title: document.title, html: handleShareHTML(document), digest: createHash('sha256').update(JSON.stringify(document)).digest('hex') };
    if (this.previews.size >= 40) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.id, { preview, document }); return preview;
  }
  get(id: string) { const value = this.previews.get(id); if (!value) throw new Error('공유 미리보기를 다시 열어 주세요.'); return value; }
  status(id: string) { return this.remote(this.get(id).preview.sourceKey); }
  mutate(id: string, operation: 'create' | 'update' | 'revoke', expectedRevision: number, confirmed: boolean) {
    if (confirmed !== true) throw new Error('공개될 내용을 확인하고 공유에 동의해 주세요.');
    const { preview, document } = this.get(id);
    return this.remote(preview.sourceKey, { operation, expectedRevision, ...(operation === 'revoke' ? {} : { document }) });
  }
}
