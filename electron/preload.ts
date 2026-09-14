import { contextBridge, ipcRenderer } from 'electron';
import type { WikiAPI } from '../shared/types';

const api: WikiAPI & { handleCloseReady(): Promise<void> } = {
  handleCalendarState: () => ipcRenderer.invoke('wiki:calendar-state'),
  handleCalendarImportClient: () => ipcRenderer.invoke('wiki:calendar-import-client'),
  handleCalendarConnect: () => ipcRenderer.invoke('wiki:calendar-connect'),
  handleCalendarCancel: () => ipcRenderer.invoke('wiki:calendar-cancel'),
  handleCalendarRefresh: () => ipcRenderer.invoke('wiki:calendar-refresh'),
  handleCalendarSelect: (ids, autoSync) => ipcRenderer.invoke('wiki:calendar-select', ids, autoSync),
  handleCalendarDisconnect: () => ipcRenderer.invoke('wiki:calendar-disconnect'),
  handleCalendarSync: automatic => ipcRenderer.invoke('wiki:calendar-sync', automatic),
  handleOpenCalendarEvent: url => ipcRenderer.invoke('wiki:calendar-open-event', url),
  handleInstallMoriSkill: () => ipcRenderer.invoke('wiki:install-mori-skill'),
  handleAppleState: () => ipcRenderer.invoke('wiki:apple-state'),
  handleAppleScan: () => ipcRenderer.invoke('wiki:apple-scan'),
  handleAppleSync: selection => ipcRenderer.invoke('wiki:apple-sync', selection),
  handleAppleResolve: (id, choice, revision, body) => ipcRenderer.invoke('wiki:apple-resolve', id, choice, revision, body),
  handleSaveQuickNote: body => ipcRenderer.invoke('wiki:quick-save', body),
  handleHideQuickNote: () => ipcRenderer.invoke('wiki:quick-hide'),
  handleBootstrap: () => ipcRenderer.invoke('wiki:bootstrap'),
  handleCreateNote: template => ipcRenderer.invoke('wiki:create', template),
  handleSaveNote: note => ipcRenderer.invoke('wiki:save', note),
  handleDailyTransfer: input => ipcRenderer.invoke('wiki:daily-transfer', input),
  handleAddLink: (sourceId, targetId, revision, reason) => ipcRenderer.invoke('wiki:add-link', sourceId, targetId, revision, reason),
  handleTrashNote: id => ipcRenderer.invoke('wiki:trash', id),
  handleListTrash: () => ipcRenderer.invoke('wiki:list-trash'),
  handleRestoreNote: id => ipcRenderer.invoke('wiki:restore', id),
  handleDeletePermanently: id => ipcRenderer.invoke('wiki:delete-permanently', id),
  handleHistory: id => ipcRenderer.invoke('wiki:history', id),
  handleListFolders: () => ipcRenderer.invoke('wiki:list-folders'),
  handleCreateFolder: name => ipcRenderer.invoke('wiki:create-folder', name),
  handleRenameFolder: (from, to) => ipcRenderer.invoke('wiki:rename-folder', from, to),
  handleDeleteFolder: name => ipcRenderer.invoke('wiki:delete-folder', name),
  handleRunAI: (id, action, instruction) => ipcRenderer.invoke('wiki:ai', id, action, instruction),
  handleCancelAI: () => ipcRenderer.invoke('wiki:cancel-ai'),
  handleSaveSettings: settings => ipcRenderer.invoke('wiki:settings', settings),
  handleSetAPIKey: key => ipcRenderer.invoke('wiki:set-api-key', key),
  handleListModels: provider => ipcRenderer.invoke('wiki:list-models', provider),
  handleCheckAI: () => ipcRenderer.invoke('wiki:check-ai'),
  handleSetShortcutRecording: recording => ipcRenderer.invoke('wiki:shortcut-recording', recording),
  handlePickExecutable: () => ipcRenderer.invoke('wiki:pick-executable'),
  handleCapture: () => ipcRenderer.invoke('wiki:capture'),
  handleImport: () => ipcRenderer.invoke('wiki:import'),
  handleExport: () => ipcRenderer.invoke('wiki:export'),
  handleRevealVault: () => ipcRenderer.invoke('wiki:reveal'),
  handleReadAttachment: name => ipcRenderer.invoke('wiki:attachment', name),
  handleCloseReady: () => ipcRenderer.invoke('wiki:close-ready'),
  handleOnCommand: callback => {
    const handleCommand = (_event: unknown, command: string) => callback(command);
    ipcRenderer.on('wiki:command', handleCommand);
    return () => ipcRenderer.removeListener('wiki:command', handleCommand);
  }
};
contextBridge.exposeInMainWorld('wiki', api);
