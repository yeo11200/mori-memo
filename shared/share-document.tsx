import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { handleParseLinks } from './links';
import { SHARE_MAX_CHARS, type SharedDocument } from './sharing';

const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
const markdownText = (text: string) => text.replace(/[!-/:-@\[-`{-~]/g, value => '&#' + value.charCodeAt(0) + ';');
export const SHARE_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Only visible document content crosses the sharing boundary. No link destinations or attachments. */
export const handlePrepareSharedDocument = (input: SharedDocument): SharedDocument => {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.body !== 'string' || !input.body.trim() || input.body.length > SHARE_MAX_CHARS) throw new Error('공유할 제목과 본문을 확인해 주세요. 본문은 100,000자까지 가능합니다.');
  let body = input.body;
  for (const link of handleParseLinks(body).reverse()) {
    const name = /^[a-f0-9-]{36}$/i.test(link.label) ? '연결된 메모' : link.label;
    body = body.slice(0, link.index) + markdownText(name) + body.slice(link.index + link.raw.length);
  }
  const edits: { start: number; end: number; text: string }[] = [];
  const plain = (node: any): string => typeof node.value === 'string' ? node.value : (node.children || []).map(plain).join('');
  const strip = () => (tree: any) => {
    const visit = (node: any) => {
      let replacement: string | undefined;
      if (['html', 'definition', 'footnoteDefinition'].includes(node.type)) replacement = '';
      if (['image', 'imageReference'].includes(node.type)) replacement = '［공유본에서 이미지 제외］';
      if (['link', 'linkReference'].includes(node.type)) replacement = markdownText(plain(node));
      if (node.type === 'footnoteReference') replacement = '［각주 제외］';
      if (replacement !== undefined && node.position) { edits.push({ start: node.position.start.offset, end: node.position.end.offset, text: replacement }); return; }
      for (const child of node.children || []) visit(child);
    };
    visit(tree);
  };
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, strip]} skipHtml>{body}</ReactMarkdown>);
  for (const edit of edits.sort((a, b) => b.start - a.start)) body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  if (!body.trim() || body.length > SHARE_MAX_CHARS) throw new Error('공개할 본문이 없거나 정리한 본문이 100,000자를 넘습니다. 내용을 줄여 주세요.');
  return { title: input.title.trim(), body: body.trim() };
};

export const handleShareHTML = (document: SharedDocument): string => {
  const content = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={() => ''} components={{
    a: ({ children }) => <span>{children}</span>,
    img: () => <span>［공유본에서 이미지 제외］</span>,
    input: ({ checked }) => <input type="checkbox" checked={!!checked} disabled readOnly />,
  }}>{document.body}</ReactMarkdown>);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta http-equiv="Content-Security-Policy" content="${escape(SHARE_CSP)}"><title>${escape(document.title)}</title><style>
body{font:16px/1.85 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172c42;background:#fff;margin:0;padding:36px 24px;overflow-wrap:anywhere}main{max-width:820px;margin:auto}header{border-bottom:1px solid #dce5ed;margin-bottom:28px;padding-bottom:18px}header p,footer{color:#617287;font-size:12px}h1{font-size:30px;line-height:1.4}h2{margin-top:30px}pre{background:#f3f6f8;padding:16px;border-radius:8px;white-space:pre-wrap}code{font-family:ui-monospace,monospace;font-size:.9em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dce5ed;padding:8px;text-align:left}blockquote{border-left:3px solid #a4c9db;margin-left:0;padding-left:16px;color:#4e6575}li{margin:4px 0}footer{margin-top:40px;border-top:1px solid #dce5ed;padding-top:14px}@page{size:A4;margin:18mm}@media print{body{padding:0;font-size:11pt}h1,h2,h3{break-after:avoid}pre,tr{break-inside:avoid}footer{font-size:9pt}}
</style></head><body><main><header><p>MORI · 읽기 전용 공유본</p><h1>${escape(document.title)}</h1></header><article>${content}</article><footer>작성자가 선택해 내보낸 문서입니다. 연결된 메모·이미지·첨부파일은 포함하지 않습니다.</footer></main></body></html>`;
};
