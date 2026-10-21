export const SHARE_MAX_CHARS = 100_000;
export const SHARE_MAX_ACTIVE = 20;
export interface SharedDocument { title: string; body: string }
export type ShareSource = { kind: 'note'; id: string } | { kind: 'report'; id: string; body: string };
export interface SharePreview { id: string; title: string; html: string; digest: string; sourceKey: string }
export interface ShareInfo { sourceKey: string; id: string; url: string; title: string; updatedAt: string; revision: number; digest: string; revoked: boolean }
export interface ShareRow { id: string; userId: string; sourceKey: string; token: string; title: string; body: string; digest: string; revision: number; updatedAt: string; revoked: boolean }
export type ShareOperation = 'create' | 'update' | 'revoke';
