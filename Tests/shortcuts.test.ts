import { describe, expect, it } from 'vitest';
import { handleInputAccelerator, handleMigrateShortcuts, handleNormalizeAccelerator, handleValidateShortcuts } from '../electron/shortcuts';

describe('shortcut mappings', () => {
  it('upgrades only the previous built-in quick-note shortcut and preserves custom or disabled bindings', () => {
    expect(handleMigrateShortcuts({}, undefined).find(item => item.action === 'quick-note')?.accelerator).toBe('CommandOrControl+Shift+Space');
    const binding = { id: 'default-quick-note', action: 'quick-note', accelerator: 'CommandOrControl+Shift+N', scope: 'global' as const };
    expect(handleMigrateShortcuts({}, [binding])[0].accelerator).toBe('CommandOrControl+Shift+Space');
    expect(handleMigrateShortcuts({}, [{ ...binding, accelerator: 'CommandOrControl+Alt+J' }])[0].accelerator).toBe('CommandOrControl+Alt+J');
    expect(handleMigrateShortcuts({}, [])).toEqual([]);
  });
  it('migrates legacy shortcuts only when shortcuts are missing', () => {
    const legacy = { captureShortcut: 'Cmd+Shift+2', quickNoteShortcut: 'CommandOrControl+Shift+N' };
    expect(handleMigrateShortcuts(legacy, undefined).map(item => item.action)).toEqual(['capture', 'quick-note', 'new', 'search', 'save', 'settings', 'palette']);
    expect(handleMigrateShortcuts(legacy, [])).toEqual([]);
    expect(handleMigrateShortcuts({ captureShortcut: '', quickNoteShortcut: '' }, undefined).every(item => !['capture', 'quick-note'].includes(item.action))).toBe(true);
  });
  it('normalizes aliases and rejects duplicate or reserved app accelerators', () => {
    expect(handleNormalizeAccelerator('shift+cmd+k')).toBe('CommandOrControl+Shift+K');
    expect(() => handleValidateShortcuts([
      { id: '1', accelerator: 'Cmd+K', action: 'search', scope: 'app' },
      { id: '2', accelerator: 'CommandOrControl+K', action: 'new', scope: 'app' }
    ], [])).toThrow(/같은 단축키/);
    expect(() => handleValidateShortcuts([{ id: '1', accelerator: 'Cmd+Q', action: 'search', scope: 'app' }], [])).toThrow(/예약/);
    expect(handleValidateShortcuts([{ id: 'empty', accelerator: '', action: 'search', scope: 'app' }], [])).toEqual([]);
    expect(() => handleValidateShortcuts([{ id: 'global-edit', accelerator: 'Cmd+C', action: 'capture', scope: 'global' }], [])).toThrow(/예약/);
  });
  it('allows multiple accelerators for one action and validates custom targets', () => {
    const result = handleValidateShortcuts([
      { id: '1', accelerator: 'Cmd+K', action: 'search', scope: 'app' },
      { id: '2', accelerator: 'Cmd+Shift+K', action: 'search', scope: 'global' },
      { id: '3', accelerator: 'Cmd+1', action: 'custom:clean', scope: 'app' }
    ], [{ id: 'clean', name: '정리', instruction: '정리해 줘' }]);
    expect(result).toHaveLength(3);
  });
  it('maps native space, digit, letter and arrow inputs to Electron accelerators', () => {
    expect(handleInputAccelerator({ key: ' ', meta: true })).toBe('CommandOrControl+Space');
    expect(handleInputAccelerator({ key: 'ArrowUp', meta: true })).toBe('CommandOrControl+Up');
    expect(handleInputAccelerator({ key: '!', code: 'Digit1', meta: true, shift: true })).toBe('CommandOrControl+Shift+1');
  });
});
