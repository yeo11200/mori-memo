import { describe, expect, it } from 'vitest';
import { handleToggleTask } from '../shared/task-list';

describe('preview task editing', () => {
  it('changes only the selected repeated task and preserves CRLF and links', () => {
    const body = '# 목록\r\n- [ ] 같은 내용 [[문서]]\r\n- [ ] 같은 내용 [[문서]]\r\n';
    const checked = handleToggleTask(body, 3, true);
    expect(checked).toBe('# 목록\r\n- [ ] 같은 내용 [[문서]]\r\n- [x] 같은 내용 [[문서]]\r\n');
    expect(handleToggleTask(checked, 3, false)).toBe(body);
  });
  it('handles ordered, nested and quoted list markers', () => {
    for (const prefix of ['  - ', '> - ', '> > 1. ', '2) ', '* ', '+ ']) {
      expect(handleToggleTask(prefix + '[X] 작업', 1, false)).toBe(prefix + '[ ] 작업');
    }
  });
  it('leaves non-task lines and invalid positions unchanged', () => {
    for (const text of ['본문 [ ] 표시', '- 일반 목록', '- [no] 일반 목록']) expect(handleToggleTask(text, 1, true)).toBe(text);
    for (const line of [0, -1, 5, 1.5]) expect(handleToggleTask('- [ ] 작업', line, true)).toBe('- [ ] 작업');
  });
});
