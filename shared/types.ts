import type { AppleProvenance, AppleSelection, AppleImportState, AppleScan } from './apple-notes';
export interface Note {
  id: string;
  title: string;
  body: string;
  folder: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  revision: string;
  aliases?: string[];
  appleSource?: AppleProvenance;
  dailyDate?: string;
  dailyTaskKeys?: string[];
  calendarSnapshots?: import('./calendar').CalendarSnapshot[];
}

export interface AppSettings {
  provider: 'codex' | 'claude' | 'openai';
  codexPath: string;
  claudePath: string;
  model: string;
  captureShortcut: string;
  quickNoteShortcut: string;
  customInstruction: string;
  shortcuts?: ShortcutBinding[];
  customCommands?: CustomCommand[];
  apiKeyConfigured?: boolean;
  launchAtLogin?: boolean;
}

export type ShortcutScope = 'app' | 'global';
export interface ShortcutBinding { id: string; accelerator: string; action: string; scope: ShortcutScope; }
export interface CustomCommand { id: string; name: string; instruction: string; }
export interface AIModel { id: string; label: string; }

export type AIAction = 'generate' | 'summary' | 'expand' | 'meeting' | 'custom' | 'connections';
export interface AIResult {
  id: string;
  noteId: string;
  revision: string;
  action: AIAction;
  text: string;
  createdAt: string;
}

export interface WikiLink {
  target: string;
  label: string;
  heading: string;
  index: number;
  raw: string;
}

export interface Bootstrap { notes: Note[]; settings: AppSettings; vaultPath: string; warnings: string[] }
export interface WikiAPI {
  handleCalendarState(): Promise<import('./calendar').CalendarState>;
  handleCalendarImportClient(): Promise<import('./calendar').CalendarState>;
  handleCalendarConnect(): Promise<import('./calendar').CalendarState>;
  handleCalendarCancel(): Promise<void>;
  handleCalendarRefresh(): Promise<import('./calendar').CalendarState>;
  handleCalendarSelect(ids: string[], autoSync: boolean): Promise<import('./calendar').CalendarState>;
  handleCalendarDisconnect(): Promise<import('./calendar').CalendarState>;
  handleCalendarSync(automatic?: boolean): Promise<Note | null>;
  handleOpenCalendarEvent(url: string): Promise<void>;
  handleInstallMoriSkill(): Promise<{ installed: string[]; backup?: string }>;
  handleAppleState(): Promise<AppleImportState>;
  handleAppleScan(): Promise<AppleScan>;
  handleAppleSync(selection: AppleSelection): Promise<AppleImportState>;
  handleAppleResolve(sourceId: string, choice: 'keep' | 'apple' | 'merge', revision: string, body?: string): Promise<AppleImportState>;
  handleSaveQuickNote(body: string): Promise<void>;
  handleHideQuickNote(): Promise<void>;
  handleBootstrap(): Promise<Bootstrap>;
  handleCreateNote(template: string): Promise<Note>;
  handleSaveNote(note: Note): Promise<Note>;
  handleDailyTransfer(input: import('./daily').DailyTransfer): Promise<import('./daily').DailyResult>;
  handleAddLink(sourceId: string, targetId: string, revision: string, reason: string): Promise<Note>;
  handleTrashNote(id: string): Promise<void>;
  handleListTrash(): Promise<Note[]>;
  handleRestoreNote(id: string): Promise<Note>;
  handleDeletePermanently(id: string): Promise<void>;
  handleHistory(id: string): Promise<Note[]>;
  handleRunAI(id: string, action: AIAction, instruction?: string): Promise<AIResult>;
  handleCancelAI(): Promise<void>;
  handleSaveSettings(settings: AppSettings): Promise<AppSettings>;
  handleListFolders(): Promise<string[]>;
  handleCreateFolder(name: string): Promise<void>;
  handleRenameFolder(from: string, to: string): Promise<void>;
  handleDeleteFolder(name: string): Promise<void>;
  handleSetAPIKey(key: string): Promise<void>;
  handleListModels(provider?: AppSettings['provider']): Promise<AIModel[]>;
  handleCheckAI(): Promise<string>;
  handleSetShortcutRecording(recording: boolean): Promise<void>;
  handlePickExecutable(): Promise<string | null>;
  handleCapture(): Promise<string | null>;
  handleImport(): Promise<Note[]>;
  handleExport(): Promise<string | null>;
  handleRevealVault(): Promise<void>;
  handleReadAttachment(name: string): Promise<string | null>;
  handleOnCommand(callback: (command: string) => void): () => void;
}
