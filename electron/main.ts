import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, shell, Tray, type IpcMainInvokeEvent, type Input } from 'electron';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Vault } from './vault/vault';
import { AppleImportService } from './apple-notes/import-service';
import { handleReadAppleNotes } from './apple-notes/source';
import { CLIRunner, handleDiscoverExecutable } from './cli/cli-runner';
import { OpenAIRunner } from './openai/openai-runner';
import { APIKeyStore } from './openai/api-key-store';
import { handleInputAccelerator, handleMigrateShortcuts, handleValidateShortcuts } from './shortcuts';
import { handleRelatedNotes, handleParseLinks, handleResolveLink } from '../shared/links';
import type { AIAction, AIModel, AIResult, AppSettings, CustomCommand, Note, ShortcutBinding } from '../shared/types';

const handleExecFile = promisify(execFile);
const runner = new CLIRunner();
const openAIRunner = new OpenAIRunner();
let window: BrowserWindow | null = null;
let quickWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let quickSaving = false;
let vault: Vault;
let appleImports: AppleImportService;
let settings: AppSettings;
let apiKeyStore: APIKeyStore;
let isCapturing = false;
let isCloseApproved = false;
let isAIWorking = false;
let isShortcutRecording = false;
const rendererPath = join(__dirname, '../dist/index.html');
const devURL = app.isPackaged ? undefined : process.env.WIKI_DEV_URL;
const startupWarnings: string[] = [];
if (process.env.WIKI_DATA_DIR) app.setPath('userData', process.env.WIKI_DATA_DIR);

const handleDefaults = (): AppSettings => ({ provider: 'codex', codexPath: handleDiscoverExecutable('codex'), claudePath: handleDiscoverExecutable('claude'), model: 'gpt-5.6-luna', captureShortcut: 'CommandOrControl+Shift+2', quickNoteShortcut: 'CommandOrControl+Shift+Space', customInstruction: '핵심을 유지하고 읽기 쉬운 문장으로 다듬어 주세요.', shortcuts: undefined, customCommands: [], launchAtLogin: false });
const handleSettingsPath = () => join(vault.root, '.wiki/settings.json');
const handleSendCommand = (command: string) => {
  if (command === 'quick-note') { void handleShowQuickNote().catch(error => dialog.showErrorBox('빠른 메모를 열지 못했습니다', String(error))); return; }
  window?.show(); window?.focus(); window?.webContents.send('wiki:command', command);
};

const handleShowQuickNote = async () => {
  if (!quickWindow) {
    quickWindow = new BrowserWindow({ width: 620, height: 350, title: 'MORI 빠른 메모', show: false, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#f7f6f2', webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    quickWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    quickWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    quickWindow.webContents.on('will-navigate', event => event.preventDefault());
    quickWindow.on('close', event => { if (!isQuitting) { event.preventDefault(); quickWindow?.hide(); } });
    quickWindow.on('closed', () => { quickWindow = null; });
    if (devURL) await quickWindow.loadURL(`${devURL}#quick-note`); else await quickWindow.loadFile(rendererPath, { hash: 'quick-note' });
  } else if (quickWindow.webContents.isLoading()) return;
  quickWindow.show(); quickWindow.focus(); quickWindow.webContents.send('wiki:command', 'quick-focus');
};

const handleValidateQuickSender = (event: IpcMainInvokeEvent) => {
  const expected = `${devURL || pathToFileURL(rendererPath).href}#quick-note`;
  if (!quickWindow || event.sender !== quickWindow.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== expected) throw new Error('허용되지 않은 요청입니다.');
};

const handleValidateSender = (event: IpcMainInvokeEvent) => {
  const expected = devURL || pathToFileURL(rendererPath).href;
  if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('#')[0] !== expected) throw new Error('허용되지 않은 요청입니다.');
};

const handleRegisterShortcuts = (next: AppSettings, strict = true) => {
  globalShortcut.unregisterAll();
  if (isShortcutRecording) return;
  try {
    for (const binding of next.shortcuts || []) {
      if (binding.scope === 'global' && !globalShortcut.register(binding.accelerator, () => handleSendCommand(binding.action))) {
        const message = `단축키 ${binding.accelerator}를 등록하지 못했습니다. 다른 조합을 선택해 주세요.`;
        if (strict) throw new Error(message);
        startupWarnings.push(message);
      }
    }
  } catch (error) { globalShortcut.unregisterAll(); throw error; }
};

const handleValidateSettings = (value: AppSettings): AppSettings => {
  if (!value || !['codex', 'claude', 'openai'].includes(value.provider)) throw new Error('AI 설정을 확인해 주세요.');
  for (const key of ['codexPath', 'claudePath', 'model', 'captureShortcut', 'quickNoteShortcut', 'customInstruction'] as const) {
    if (typeof value[key] !== 'string' || value[key].length > (key === 'customInstruction' ? 4000 : 500)) throw new Error('설정값을 확인해 주세요.');
  }
  const customCommands = handleValidateCustomCommands(value.customCommands || []);
  const shortcuts = handleValidateShortcuts(handleMigrateShortcuts(value, value.shortcuts), customCommands);
  const defaultModel = value.provider === 'codex' ? 'gpt-5.6-luna' : value.provider === 'openai' ? 'gpt-5-nano' : '';
  return { provider: value.provider, codexPath: value.codexPath.trim(), claudePath: value.claudePath.trim(), model: value.model.trim() || defaultModel, captureShortcut: value.captureShortcut.trim(), quickNoteShortcut: value.quickNoteShortcut.trim(), customInstruction: value.customInstruction, shortcuts, customCommands, apiKeyConfigured: !!value.apiKeyConfigured, launchAtLogin: value.launchAtLogin === true };
};

const handleValidateCustomCommands = (commands: CustomCommand[]): CustomCommand[] => {
  if (!Array.isArray(commands) || commands.length > 50) throw new Error('사용자 명령을 확인해 주세요.');
  const ids = new Set<string>();
  return commands.map(command => {
    if (!command || typeof command.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(command.id) || ids.has(command.id) || typeof command.name !== 'string' || !command.name.trim() || command.name.length > 80 || typeof command.instruction !== 'string' || !command.instruction.trim() || command.instruction.length > 4000) throw new Error('사용자 명령을 확인해 주세요.');
    ids.add(command.id);
    return { id: command.id, name: command.name.trim(), instruction: command.instruction };
  });
};

const MODEL_CATALOGS: Record<AppSettings['provider'], AIModel[]> = {
  codex: [{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (기본)' }],
  claude: [{ id: '', label: 'Claude CLI 기본 모델' }],
  openai: [{ id: 'gpt-5-nano', label: 'GPT-5 nano (기본)' }, { id: 'gpt-5-mini', label: 'GPT-5 mini' }, { id: 'gpt-5', label: 'GPT-5' }]
};

const handleCapture = async () => {
  if (isCapturing) throw new Error('이미 화면을 캡처하고 있습니다.');
  isCapturing = true;
  const directory = await mkdtemp(join(tmpdir(), 'personal-wiki-capture-'));
  const filename = `${randomUUID()}.png`;
  const path = join(directory, filename);
  try {
    window?.hide();
    await new Promise(resolve => setTimeout(resolve, 250));
    try { await handleExecFile('/usr/sbin/screencapture', ['-i', '-x', path], { timeout: 120000 }); }
    catch (error) {
      if ((error as { code?: number }).code === 1) return null;
      throw new Error('캡처하지 못했습니다. 시스템 설정의 화면 기록 권한을 확인해 주세요.');
    }
    try { await readFile(path); } catch { return null; }
    return await vault.handleAddAttachment(path, filename);
  } finally {
    await rm(directory, { recursive: true, force: true });
    isCapturing = false;
    window?.show(); window?.focus();
  }
};

const handleRunAI = async (id: string, action: AIAction, instruction?: string): Promise<AIResult> => {
  if (isAIWorking) throw new Error('진행 중인 AI 작업을 먼저 마치거나 취소해 주세요.');
  if (!['generate', 'summary', 'expand', 'meeting', 'custom', 'connections'].includes(action)) throw new Error('알 수 없는 작업입니다.');
  if (action === 'generate' && (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4000)) throw new Error('작성할 주제나 요청을 4,000자 이내로 입력해 주세요.');
  if (action === 'custom' && instruction !== undefined && (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4000)) throw new Error('사용자 명령을 4,000자 이내로 입력해 주세요.');
  isAIWorking = true;
  try {
    const note = await vault.handleGet(id);
    if (action !== 'generate' && !note.body.trim()) throw new Error('먼저 메모를 작성해 주세요.');
    const prompts: Record<AIAction, string> = {
      generate: `사용자의 요청에 맞는 한국어 문서 초안을 작성하세요. 예시나 제안은 실제 사실과 구분하고 알 수 없는 개인 정보나 회의 사실은 만들어 내지 마세요. 사용자 요청:\n${instruction || ''}`,
      summary: '한국어로 이 메모의 핵심을 간결하게 요약해 주세요. 핵심 내용과 명시된 할 일을 구분하세요.',
      expand: '이 메모를 자연스럽고 이해하기 쉬운 한국어 설명글로 풀어 써 주세요. 원문에 없는 사실을 보충하지 마세요.',
      meeting: '이 메모를 한국어 회의록으로 정리해 주세요. 논의 내용, 결정 사항, 후속 작업을 구분하고 담당자나 날짜는 원문에 있을 때만 적으세요.',
      custom: instruction?.trim() || settings.customInstruction,
      connections: '현재 메모와 후보 메모의 관계를 검토하세요. 명확한 관계가 있는 항목만 최대 5개 골라 `- [[문서 제목]] — 연결 이유. 근거: 원문 문장` 형식으로 한국어로 쓰세요. 없는 문서를 만들지 마세요. 관련이 없으면 없다고 답하세요.'
    };
    let content = note.body;
    const candidates = action === 'connections' ? handleRelatedNotes(note, await vault.handleList()).map(item => item.note) : [];
    if (action === 'connections') {
      if (!candidates.length) throw new Error('아직 연결할 후보가 없습니다. 같은 주제의 메모를 더 작성해 주세요.');
      content = `현재 메모: ${note.title}\n${note.body}\n\n후보 메모:\n` + candidates.map(candidate => `제목: ${candidate.title}\n${candidate.body.slice(0, 6000)}`).join('\n\n');
    }
    const request = { instruction: `${prompts[action]}\nMarkdown으로 작성하고 원문에 없는 사실·담당자·일정을 만들어 내지 마세요.`, content };
    const text = settings.provider === 'openai'
      ? await openAIRunner.handleRun(request, { apiKey: await apiKeyStore.handleGet() || '', model: settings.model || 'gpt-5-nano', timeoutMs: 180000 })
      : await runner.handleRun(request, { provider: settings.provider, executablePath: settings.provider === 'codex' ? settings.codexPath : settings.claudePath, model: settings.model, timeoutMs: 180000 });
    if (action === 'connections' && handleParseLinks(text).some(link => !handleResolveLink(link.target, candidates))) throw new Error('AI가 후보에 없는 문서를 연결했습니다. 결과를 적용하지 않았습니다. 다시 시도해 주세요.');
    const result: AIResult = { id: randomUUID(), noteId: id, revision: note.revision, action, text, createdAt: new Date().toISOString() };
    await writeFile(join(vault.root, '.wiki/results', `${result.id}.json`), JSON.stringify(result), { mode: 0o600 });
    return result;
  } finally { isAIWorking = false; }
};

const handleIPC = () => {
  ipcMain.handle('wiki:quick-save', async (event, body: unknown) => {
    handleValidateQuickSender(event);
    if (quickSaving) throw new Error('메모를 저장하고 있습니다.');
    if (typeof body !== 'string' || !body.trim() || body.length > 2_000_000) throw new Error('메모를 2MB 이내로 입력해 주세요.');
    quickSaving = true;
    try {
      await vault.handleCreate(body.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 160), body);
      window?.webContents.send('wiki:command', 'notes-changed');
    } finally { quickSaving = false; }
  });
  ipcMain.handle('wiki:quick-hide', event => { handleValidateQuickSender(event); if (!quickSaving) quickWindow?.hide(); });
  const handleOn = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(`wiki:${channel}`, (event, ...args) => { handleValidateSender(event); return fn(...args); });
  appleImports = new AppleImportService(vault, handleReadAppleNotes);
  handleOn('apple-state', () => appleImports.handleState());
  handleOn('apple-scan', () => appleImports.handleScan());
  handleOn('apple-sync', (selection) => appleImports.handleSync(selection));
  handleOn('apple-resolve', (id, choice, revision, body) => appleImports.handleResolve(id, choice, revision, body));
  handleOn('bootstrap', async () => {
    const keyStatus = await apiKeyStore.handleStatus();
    return { notes: await vault.handleList(), settings: { ...settings, apiKeyConfigured: keyStatus.configured }, vaultPath: vault.root, warnings: [...startupWarnings, ...vault.warnings, ...(keyStatus.warning ? [keyStatus.warning] : [])] };
  });
  handleOn('create', async (template: string) => {
    const date = new Date().toLocaleDateString('sv-SE');
    const templates: Record<string, [string, string, string]> = {
      blank: ['제목 없는 메모', '', '미분류'],
      daily: [`${date} 데일리 노트`, '## 오늘의 메모\n\n\n## 할 일\n\n- [ ] \n', '데일리'],
      meeting: [`${date} 회의 메모`, '## 회의 메모\n\n\n## 결정 사항\n\n\n## 다음 할 일\n\n- [ ] \n', '회의록']
    };
    const [title, body, folder] = templates[template] || templates.blank;
    return vault.handleCreate(title, body, folder);
  });
  handleOn('save', (note: Note) => vault.handleSave(note));
  handleOn('add-link', (sourceId: string, targetId: string, revision: string, reason: string) => vault.handleAddLink(sourceId, targetId, revision, reason));
  handleOn('trash', (id: string) => vault.handleTrash(id));
  handleOn('list-trash', () => vault.handleListTrash());
  handleOn('restore', (id: string) => vault.handleRestore(id));
  handleOn('delete-permanently', (id: string) => vault.handleDeletePermanently(id));
  handleOn('history', (id: string) => vault.handleHistory(id));
  handleOn('list-folders', () => vault.handleListFolders());
  handleOn('create-folder', (name: string) => vault.handleCreateFolder(name));
  handleOn('rename-folder', (from: string, to: string) => vault.handleRenameFolder(from, to));
  handleOn('delete-folder', (name: string) => vault.handleDeleteFolder(name));
  handleOn('ai', handleRunAI);
  handleOn('cancel-ai', () => { runner.handleCancel(); openAIRunner.handleCancel(); });
  handleOn('set-api-key', async (key: string) => { await apiKeyStore.handleSet(key); settings.apiKeyConfigured = (await apiKeyStore.handleStatus()).configured; });
  handleOn('list-models', (provider?: AppSettings['provider']) => {
    const selected = provider || settings.provider;
    if (!MODEL_CATALOGS[selected]) throw new Error('AI 제공자를 확인해 주세요.');
    return MODEL_CATALOGS[selected].map(model => ({ ...model }));
  });
  handleOn('check-ai', async () => {
    const text = settings.provider === 'openai'
      ? await openAIRunner.handleRun({ instruction: '연결 상태를 확인하고 OK만 출력하세요.', content: '' }, { apiKey: await apiKeyStore.handleGet() || '', model: settings.model || 'gpt-5-nano', timeoutMs: 30_000 })
      : await runner.handleRun({ instruction: '연결 상태를 확인하고 OK만 출력하세요.', content: '' }, { provider: settings.provider, executablePath: settings.provider === 'codex' ? settings.codexPath : settings.claudePath, model: settings.model, timeoutMs: 30_000 });
    return text.trim() ? 'AI 연결을 확인했습니다.' : 'AI가 빈 결과를 반환했습니다.';
  });
  handleOn('shortcut-recording', (recording: boolean) => {
    if (typeof recording !== 'boolean') throw new Error('단축키 기록 상태를 확인해 주세요.');
    isShortcutRecording = recording;
    window?.webContents.setIgnoreMenuShortcuts(recording);
    handleRegisterShortcuts(settings);
  });
  handleOn('settings', async (value: AppSettings) => {
    const next = handleValidateSettings(value);
    next.apiKeyConfigured = (await apiKeyStore.handleStatus()).configured;
    if (isAIWorking) throw new Error('AI 작업이 끝난 뒤 설정을 바꿔 주세요.');
    try {
      handleRegisterShortcuts(next);
      const path = handleSettingsPath();
      const persisted = { ...next }; delete persisted.apiKeyConfigured;
      await writeFile(`${path}.tmp`, JSON.stringify(persisted, null, 2), { mode: 0o600 });
      const { rename } = await import('node:fs/promises');
      await rename(`${path}.tmp`, path);
    } catch (error) { try { handleRegisterShortcuts(settings); } catch { /* 이전 단축키가 다른 앱에 등록된 경우 설정창에서 수정합니다. */ } throw error; }
    settings = next;
    if (process.platform === 'darwin' && app.isPackaged && !process.env.WIKI_DATA_DIR) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin === true });
    return next;
  });
  handleOn('pick-executable', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Claude 또는 Codex 실행 파일 선택', properties: ['openFile', 'showHiddenFiles'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handleOn('capture', handleCapture);
  handleOn('import', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Markdown 메모 가져오기', filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }], properties: ['openFile', 'multiSelections'] });
    const notes: Note[] = [];
    for (const path of result.filePaths) notes.push(await vault.handleImport(path));
    return notes;
  });
  handleOn('export', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '백업을 저장할 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const destination = join(result.filePaths[0], `MORI-${Date.now()}`);
    await vault.handleExport(destination);
    return destination;
  });
  handleOn('reveal', () => shell.openPath(vault.root));
  handleOn('attachment', async (name: string) => {
    if (typeof name !== 'string' || !/^Attachments\/[a-f0-9-]{36}\.png$/.test(name)) return null;
    const bytes = await readFile(join(vault.root, name));
    if (bytes.length > 30_000_000) return null;
    return `data:image/png;base64,${bytes.toString('base64')}`;
  });
  handleOn('close-ready', () => { isCloseApproved = true; if (isQuitting) app.quit(); else window?.close(); });
};

const handleCreateWindow = async () => {
  window = new BrowserWindow({ width: 1360, height: 890, minWidth: 1000, minHeight: 640, title: 'MORI · 나의 지식정원', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 }, backgroundColor: '#f7f6f2', webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('before-input-event', (event, input: Input) => {
    if (isShortcutRecording || input.type !== 'keyDown' || input.isAutoRepeat) return;
    const accelerator = handleInputAccelerator(input);
    const binding = settings.shortcuts?.find(item => item.scope === 'app' && item.accelerator === accelerator);
    if (binding) { event.preventDefault(); handleSendCommand(binding.action); }
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close', event => {
    if (!isCloseApproved) { event.preventDefault(); window?.webContents.send('wiki:command', 'close'); }
    else if (!isQuitting) { event.preventDefault(); window?.hide(); isCloseApproved = false; }
  });
  window.on('closed', () => { runner.handleCancel(); openAIRunner.handleCancel(); window = null; });
  if (devURL) await window.loadURL(devURL); else await window.loadFile(rendererPath);
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const userData = process.env.WIKI_DATA_DIR || app.getPath('userData');
    vault = new Vault(join(userData, 'Vault'));
    apiKeyStore = new APIKeyStore(join(userData, 'Secrets', 'openai-api-key.bin'), safeStorage);
    await vault.handleInitialize();
    settings = handleValidateSettings(handleDefaults());
    try { settings = handleValidateSettings(JSON.parse(await readFile(handleSettingsPath(), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') startupWarnings.push('설정 파일을 읽지 못해 기본 설정으로 시작했습니다.'); }
    if (settings.provider === 'codex' && (!settings.model || settings.model === 'gpt-5.4-mini')) settings.model = 'gpt-5.6-luna';
    try { handleRegisterShortcuts(settings, false); } catch (error) { startupWarnings.push((error as Error).message); }
    handleIPC();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'MORI', submenu: [{ label: '설정…', click: () => handleSendCommand('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
      { label: '파일', submenu: [{ label: '새 메모', click: () => handleSendCommand('new') }, { label: '빠른 메모', click: () => handleSendCommand('quick-note') }, { label: '메모 검색', click: () => handleSendCommand('search') }, { label: '저장', click: () => handleSendCommand('save') }, { label: '명령 팔레트', click: () => handleSendCommand('palette') }, { label: '화면 캡처', click: () => handleSendCommand('capture') }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
    ]));
    await handleCreateWindow();
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('M'); tray.setToolTip('MORI · 빠른 메모');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'MORI 열기', click: () => { window?.show(); window?.focus(); } }, { label: '빠른 메모', click: () => handleSendCommand('quick-note') }, { label: '설정', click: () => handleSendCommand('settings') }, { type: 'separator' }, { label: 'MORI 종료', click: () => app.quit() }]));
  }).catch(error => { dialog.showErrorBox('MORI를 열지 못했습니다', String(error)); app.exit(1); });
  app.on('activate', () => { if (!window && vault) { isCloseApproved = false; void handleCreateWindow(); } else window?.show(); });
  app.on('before-quit', event => {
    isQuitting = true;
    if (window && !isCloseApproved) { event.preventDefault(); window.webContents.send('wiki:command', 'close'); }
  });
  app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); runner.handleCancel(); openAIRunner.handleCancel(); });
}
