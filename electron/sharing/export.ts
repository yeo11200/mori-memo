import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const handleExportSharedDocument = async (parent: BrowserWindow, title: string, html: string, format: 'html' | 'pdf'): Promise<string | null> => {
  if (!['html', 'pdf'].includes(format)) throw new Error('내보내기 형식을 확인해 주세요.');
  const { canceled, filePath } = await dialog.showSaveDialog(parent, { title: format === 'pdf' ? 'PDF로 내보내기' : 'HTML로 내보내기', defaultPath: title.replace(/[/\\:*?"<>|]/g, '-') + '.' + format, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
  if (canceled || !filePath) return null;
  if (format === 'html') { await writeFile(filePath, html, { mode: 0o600 }); return filePath; }
  const print = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'mori-pdf-' + randomUUID() } });
  print.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  print.webContents.on('will-navigate', event => event.preventDefault());
  print.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  print.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (_details, callback) => callback({ cancel: true }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const buffer = await Promise.race([
      (async () => { await print.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); return print.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true }); })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PDF를 만들지 못했습니다. 다시 시도해 주세요.')), 20000); }),
    ]);
    await writeFile(filePath, buffer, { mode: 0o600 }); return filePath;
  } finally { clearTimeout(timer); print.destroy(); }
};
