import { createContext, useContext, useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { handlePreviewMarkdown } from '../../../../shared/links';
import { handleToggleTask } from '../../../../shared/task-list';

const TaskLineContext = createContext<number | undefined>(undefined);
const TaskEditContext = createContext<{ body: string; onEdit?: (body: string) => void; disabled: boolean }>({ body: '', disabled: true });
const TaskListItem = ({ node, children, ...props }: ComponentProps<'li'> & ExtraProps) => (
  <li {...props}><TaskLineContext.Provider value={node?.position?.start.line}>{children}</TaskLineContext.Provider></li>
);
const TaskCheckbox = ({ type, checked }: ComponentProps<'input'> & ExtraProps) => {
  const line = useContext(TaskLineContext);
  const { body, onEdit, disabled } = useContext(TaskEditContext);
  return type === 'checkbox' ? <input type="checkbox" checked={!!checked} disabled={disabled || !onEdit || line === undefined}
    aria-label={`할 일 ${line ?? ''}행 완료`} onChange={event => { if (line !== undefined) onEdit?.(handleToggleTask(body, line, event.target.checked)); }} /> : null;
};

const Attachment = ({ source, label }: { source: string; label: string }) => {
  const [url, setURL] = useState<string | null>(null);
  useEffect(() => { let alive = true; setURL(null); window.wiki.handleReadAttachment(source).then(value => { if (alive) setURL(value); }).catch(() => undefined); return () => { alive = false; }; }, [source]);
  return url ? <img src={url} alt={label} /> : <span className="wiki__attachment__placeholder">첨부 이미지 · {label}</span>;
};

export const MarkdownView = ({ body, onLink, onEdit, disabled = false }: { body: string; onLink: (target: string, heading?: string) => void; onEdit?: (body: string) => void; disabled?: boolean }) => (
  <TaskEditContext.Provider value={{ body, onEdit, disabled }}><div className="wiki__markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => /^(wiki:|Attachments\/|https?:|#)/.test(url) ? url : ''} components={{
      li: TaskListItem,
      input: TaskCheckbox,
      a: ({ href, children }) => href?.startsWith('wiki:') ? <button className="wiki__inline__link" onClick={() => {
        const [target, heading] = href.slice(5).split('#');
        try { onLink(decodeURIComponent(target), heading ? decodeURIComponent(heading) : undefined); } catch { /* 잘못된 링크는 탐색하지 않습니다. */ }
      }}>{children}</button> : <span className="wiki__external__link" title={href}>{children}</span>,
      img: ({ src, alt }) => src?.startsWith('Attachments/') ? <Attachment source={src} label={alt || '이미지'} /> : <span>외부 이미지: {alt || src}</span>,
      h1: ({ children }) => <h1 id={String(children)}>{children}</h1>,
      h2: ({ children }) => <h2 id={String(children)}>{children}</h2>,
      h3: ({ children }) => <h3 id={String(children)}>{children}</h3>
    }}>{handlePreviewMarkdown(body)}</ReactMarkdown>
  </div></TaskEditContext.Provider>
);
