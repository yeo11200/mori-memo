export const handleNotePreview = (body: string, limit = 240) => body
  .replace(/ <!-- mori-task:[a-f0-9]{64} -->/g, '')
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label || target)
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
