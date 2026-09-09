import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppleCatalog } from '../../shared/apple-notes';

// 설치된 Notes.sdef의 읽기 속성만 사용합니다. 원본을 변경하는 명령은 없습니다.
export const APPLE_NOTES_SCRIPT = `
var app = Application('Notes');
var folders = [], notes = [], seenFolders = {}, seenNotes = {};
function visit(folder, path) {
  var id = folder.id();
  if (seenFolders[id]) return;
  seenFolders[id] = true;
  var name = path + ' / ' + folder.name();
  folders.push({id:id, name:name});
  var children = folder.notes();
  for (var i = 0; i < children.length; i++) {
    var n = children[i], nid = n.id();
    if (seenNotes[nid]) continue;
    seenNotes[nid] = true;
    var item = {id:nid, title:n.name(), folderId:id, folder:name, body:'', warnings:[]};
    try {
      if (n.passwordProtected()) item.error = '잠긴 메모는 가져오지 않습니다. Apple 메모에서 잠금을 해제한 뒤 다시 시도하세요.';
      else {
        item.body = n.plaintext();
        var count = n.attachments.length;
        if (count) item.warnings.push('첨부파일 ' + count + '개는 가져오지 않았습니다. Apple 메모에서 확인하세요.');
      }
    } catch (e) { item.error = '이 메모의 본문을 읽지 못했습니다. Apple 메모에서 열어 확인하세요.'; }
    notes.push(item);
  }
  var subfolders = folder.folders();
  for (var j = 0; j < subfolders.length; j++) visit(subfolders[j], name);
}
var accounts = app.accounts();
for (var i = 0; i < accounts.length; i++) {
  var roots = accounts[i].folders();
  for (var j = 0; j < roots.length; j++) visit(roots[j], accounts[i].name());
}
JSON.stringify({folders:folders, notes:notes, warnings:['본문은 일반 텍스트로 가져옵니다. 표·체크 상태·서식·사진·PDF는 원본과 다를 수 있습니다.']});
`;

export const handleReadAppleNotes = async (): Promise<AppleCatalog> => {
  if (process.platform !== 'darwin') throw new Error('Apple 메모 연동은 macOS에서 사용할 수 있습니다.');
  try {
    const { stdout } = await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', APPLE_NOTES_SCRIPT], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
    const catalog: AppleCatalog = JSON.parse(stdout);
    if (!Array.isArray(catalog.notes) || !Array.isArray(catalog.folders)) throw new Error('invalid');
    return catalog;
  } catch (error) {
    const detail = String(error);
    if (detail.includes('-1743')) throw new Error('Apple 메모 접근이 허용되지 않았습니다. 시스템 설정 → 개인정보 보호 및 보안 → 자동화에서 MORI의 메모 접근을 허용한 뒤 다시 시도하세요.');
    throw new Error('Apple 메모를 읽지 못했습니다. 메모 앱과 접근 허용 창을 확인하고 다시 시도하세요. 메모가 많으면 시간이 걸릴 수 있습니다.');
  }
};
