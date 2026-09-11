import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleReadCodexModels, MODEL_CATALOGS } from '../electron/cli/model-catalog';

describe('model catalog', () => {
  it('reads new visible models, excludes hidden entries and duplicates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mori-models-'));
    const path = join(directory, 'models.json');
    await writeFile(path, JSON.stringify({ models: [
      { slug: 'new-model', display_name: 'New model', visibility: 'list' },
      { slug: 'internal', visibility: 'hide' },
      { slug: 'new-model', visibility: 'list' }, null, { slug: 42 },
    ] }));
    expect(await handleReadCodexModels(path)).toEqual([{ id: 'new-model', label: 'New model' }]);
    await writeFile(path, JSON.stringify({ models: [{ slug: 'next-model', visibility: 'list' }] }));
    expect((await handleReadCodexModels(path))[0].id).toBe('next-model');
  });
  it('falls back for missing, invalid or empty cache', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mori-models-'));
    const path = join(directory, 'models.json');
    expect(await handleReadCodexModels(path)).toEqual(MODEL_CATALOGS.codex);
    for (const content of ['{bad', 'null', '{"models":[]}', '{"models":[{"slug":"hidden","visibility":"hide"}]}']) {
      await writeFile(path, content);
      expect(await handleReadCodexModels(path)).toEqual(MODEL_CATALOGS.codex);
    }
  });
  it('offers Claude family aliases and the CLI default', () => {
    expect(MODEL_CATALOGS.claude.map(model => model.id)).toEqual(['', 'haiku', 'sonnet', 'opus', 'fable']);
  });
});
