import { SHARE_MAX_ACTIVE, type ShareRow } from '../shared/sharing';
import { BillingError } from '../server/billing/service';
import type { ShareMutation, ShareStore } from '../server/sharing/service';

export class MemoryShareStore implements ShareStore {
  rows = new Map<string, ShareRow>();
  async list(userId: string) { return structuredClone([...this.rows.values()].filter(row => row.userId === userId && !row.revoked)); }
  async owner(userId: string, key: string) { return structuredClone(this.rows.get(userId + ':' + key) || null); }
  async public(token: string) { return structuredClone([...this.rows.values()].find(row => row.token === token && !row.revoked) || null); }
  async mutate(userId: string, input: ShareMutation): Promise<ShareRow> {
    const key = userId + ':' + input.sourceKey; const row = this.rows.get(key);
    if (input.operation === 'create' && row && !row.revoked) return structuredClone(row);
    if ((row?.revision || 0) !== input.expectedRevision) throw new BillingError('share_conflict', 409);
    if (input.operation !== 'create' && (!row || (input.operation === 'update' && row.revoked))) throw new BillingError('share_missing', 409);
    if (input.operation === 'create' && [...this.rows.values()].filter(value => value.userId === userId && !value.revoked).length >= SHARE_MAX_ACTIVE) throw new BillingError('share_limit', 409);
    const next: ShareRow = { id: row?.id || input.id, userId, sourceKey: input.sourceKey, token: row && !row.revoked ? row.token : input.token, title: input.document?.title || row!.title, body: input.operation === 'revoke' ? '' : input.document!.body, digest: input.document ? input.digest : row!.digest, revision: (row?.revision || 0) + 1, updatedAt: new Date().toISOString(), revoked: input.operation === 'revoke' };
    this.rows.set(key, next); return structuredClone(next);
  }
}
