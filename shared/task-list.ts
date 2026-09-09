/** 렌더링된 할 일의 원문 행에서 체크 문자만 교체합니다. */
export const handleToggleTask = (body: string, line: number, checked: boolean): string => {
  if (!Number.isInteger(line) || line < 1) return body;
  const lines = body.split('\n');
  const original = lines[line - 1];
  if (original === undefined) return body;
  const match = original.match(/^[\t >]*(?:[-+*]|\d+[.)])[\t ]+\[([ xX])\](?=[\t \r]|$)/);
  if (!match) return body;
  const index = match[0].lastIndexOf('[') + 1;
  lines[line - 1] = original.slice(0, index) + (checked ? 'x' : ' ') + original.slice(index + 1);
  return lines.join('\n');
};
