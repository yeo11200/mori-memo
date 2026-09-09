/** Apple 원본을 읽어서 만든 내부 표준 메모입니다. */
export interface AppleNote { id: string; title: string; body: string; folderId: string; folder: string; warnings: string[]; error?: string }
export interface AppleCatalog { folders: { id: string; name: string }[]; notes: AppleNote[]; warnings: string[] }
export interface AppleProvenance { sourceId: string; sourceTitle: string; sourceFolder: string; importedAt: string; lastSeenAt: string; sourceHash: string; importedHash: string; warnings: string[] }
export type AppleStatus = 'created' | 'updated' | 'unchanged' | 'review' | 'failed' | 'missing' | 'trashed';
export interface AppleResult { sourceId: string; title: string; status: AppleStatus; noteId?: string; message?: string }
export interface AppleReview { source: AppleNote; noteId: string }
export interface AppleImportState { folderIds: string[]; noteIds: string[]; reviews: AppleReview[]; results: AppleResult[]; lastSyncAt?: string }
export interface AppleSelection { mode: 'all' | 'selected'; folderIds: string[]; noteIds: string[] }
export interface AppleScan { catalog: AppleCatalog; state: AppleImportState; preview: AppleResult[] }
