import { readFile } from 'node:fs/promises';
import type { AIModel, AppSettings } from '../../shared/types';

// CLI 캐시가 없는 새 설치에서 제공할 목록. 계정별 사용 권한을 보장하지 않습니다.
export const MODEL_CATALOGS: Record<AppSettings['provider'], AIModel[]> = {
  codex: [
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
    { id: 'gpt-5.5', label: 'GPT-5.5' },
  ],
  claude: [
    { id: '', label: 'Claude CLI 기본 모델' },
    { id: 'haiku', label: 'Haiku · CLI 권장 버전' },
    { id: 'sonnet', label: 'Sonnet · CLI 권장 버전' },
    { id: 'opus', label: 'Opus · CLI 권장 버전' },
    { id: 'fable', label: 'Fable · CLI 권장 버전 (추가 크레딧 가능)' },
  ],
  openai: [{ id: 'gpt-5-nano', label: 'GPT-5 nano (기본)' }, { id: 'gpt-5-mini', label: 'GPT-5 mini' }, { id: 'gpt-5', label: 'GPT-5' }],
};

/** Codex가 저장한 공개 선택 목록을 매번 다시 읽고, 캐시가 없거나 손상되면 기본 목록을 반환합니다. */
export const handleReadCodexModels = async (path: string): Promise<AIModel[]> => {
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    const models = new Map<string, AIModel>();
    for (const model of Array.isArray(data?.models) ? data.models : []) {
      if (model?.visibility !== 'list' || typeof model.slug !== 'string' || !model.slug.trim() || model.slug.length > 200 || models.has(model.slug)) continue;
      models.set(model.slug, { id: model.slug, label: typeof model.display_name === 'string' && model.display_name.trim() ? model.display_name : model.slug });
    }
    if (models.size) return [...models.values()];
  } catch { /* 캐시 없이도 첫 실행에서 모델을 선택할 수 있도록 합니다. */ }
  return MODEL_CATALOGS.codex.map(model => ({ ...model }));
};
