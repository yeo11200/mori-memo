import type { CustomCommand, ShortcutBinding } from '../shared/types';

const ACTIONS = new Set(['capture', 'quick-note', 'new', 'search', 'ai', 'save', 'settings', 'palette']);
const RESERVED = new Set(['CommandOrControl+Q', 'CommandOrControl+W', 'CommandOrControl+H', 'CommandOrControl+M', 'CommandOrControl+C', 'CommandOrControl+V', 'CommandOrControl+X', 'CommandOrControl+A', 'CommandOrControl+Z', 'CommandOrControl+Shift+Z']);
const MODIFIERS: Record<string, string> = { cmd: 'CommandOrControl', command: 'CommandOrControl', commandorcontrol: 'CommandOrControl', ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super' };
const ORDER = ['CommandOrControl', 'Control', 'Alt', 'Shift', 'Super'];

export function handleNormalizeAccelerator(input: string): string {
  if (typeof input !== 'string') throw new Error('단축키를 확인해 주세요.');
  const parts = input.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) throw new Error('보조 키가 포함된 단축키를 입력해 주세요.');
  const key = parts.pop()!;
  const modifiers = [...new Set(parts.map(part => MODIFIERS[part.toLocaleLowerCase()] || part))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (modifiers.some(item => !ORDER.includes(item)) || !/^(?:[A-Za-z0-9,./;\[\]'`=-]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Escape|Tab|Up|Down|Left|Right)$/.test(key)) throw new Error('지원하지 않는 단축키입니다.');
  const normalizedKey = /^[a-z]$/i.test(key) ? key.toUpperCase() : key;
  return [...modifiers, normalizedKey].join('+');
}

export function handleMigrateShortcuts(legacy: { captureShortcut?: string; quickNoteShortcut?: string }, shortcuts: ShortcutBinding[] | undefined): ShortcutBinding[] {
  if (shortcuts !== undefined) return shortcuts.map(binding => binding.id === 'default-quick-note' && binding.action === 'quick-note' && binding.accelerator === 'CommandOrControl+Shift+N' ? { ...binding, accelerator: 'CommandOrControl+Shift+Space' } : binding);
  return [
    ['capture', legacy.captureShortcut ?? 'CommandOrControl+Shift+2', 'global'],
    ['quick-note', legacy.quickNoteShortcut === 'CommandOrControl+Shift+N' ? 'CommandOrControl+Shift+Space' : legacy.quickNoteShortcut ?? 'CommandOrControl+Shift+Space', 'global'],
    ['new', 'CommandOrControl+N', 'app'], ['search', 'CommandOrControl+K', 'app'], ['save', 'CommandOrControl+S', 'app'],
    ['settings', 'CommandOrControl+,', 'app'], ['palette', 'CommandOrControl+Shift+P', 'app']
  ].filter(([, accelerator]) => accelerator).map(([action, accelerator, scope]) => ({ id: `default-${action}`, action, accelerator, scope })) as ShortcutBinding[];
}

export function handleValidateShortcuts(bindings: ShortcutBinding[], commands: CustomCommand[]): ShortcutBinding[] {
  if (!Array.isArray(bindings) || bindings.length > 100) throw new Error('단축키 설정을 확인해 주세요.');
  const commandIds = new Set(commands.map(command => command.id));
  const seen = new Set<string>();
  return bindings.filter(binding => binding?.accelerator !== '').map(binding => {
    if (!binding || typeof binding.id !== 'string' || !binding.id || !['app', 'global'].includes(binding.scope)) throw new Error('단축키 설정을 확인해 주세요.');
    if (!ACTIONS.has(binding.action) && !(binding.action.startsWith('custom:') && commandIds.has(binding.action.slice(7)))) throw new Error('단축키 동작을 확인해 주세요.');
    const accelerator = handleNormalizeAccelerator(binding.accelerator);
    const identity = accelerator.toLocaleLowerCase();
    if (seen.has(identity)) throw new Error('같은 단축키를 여러 동작에 지정할 수 없습니다.');
    if (RESERVED.has(accelerator)) throw new Error(`${accelerator}은 앱 메뉴에 예약된 단축키입니다.`);
    seen.add(identity);
    return { ...binding, accelerator };
  });
}

export function handleInputAccelerator(input: { key: string; code?: string; meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean }): string {
  const modifiers = [input.meta ? 'CommandOrControl' : '', input.control ? 'Control' : '', input.alt ? 'Alt' : '', input.shift ? 'Shift' : ''].filter(Boolean);
  let key = input.key.replace(/^Arrow/, '');
  if (input.code === 'Space' || input.key === ' ') key = 'Space';
  else if (input.code?.startsWith('Digit')) key = input.code.slice(5);
  else if (input.code?.startsWith('Key')) key = input.code.slice(3);
  return modifiers.length ? [...modifiers, key.length === 1 ? key.toUpperCase() : key].join('+') : '';
}
