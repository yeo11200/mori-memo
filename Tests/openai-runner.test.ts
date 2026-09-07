import { describe, expect, it, vi } from 'vitest';
import { OpenAIRunner } from '../electron/openai/openai-runner';

describe('OpenAI Responses runner', () => {
  it('sends bounded Responses input and returns output_text', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ model: 'gpt-5-nano', max_output_tokens: 4096 });
      expect(body.store).toBe(false);
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '결과' }] }] }), { status: 200 });
    });
    await expect(new OpenAIRunner(fetch).handleRun({ instruction: '요약', content: '원문' }, { apiKey: 'secret', model: 'gpt-5-nano' })).resolves.toBe('결과');
  });
  it('rejects incomplete responses instead of returning truncated text', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ content: [{ type: 'output_text', text: '잘림' }] }] }), { status: 200 }));
    await expect(new OpenAIRunner(fetch).handleRun({ instruction: '요약', content: '원문' }, { apiKey: 'key', model: 'gpt-5-nano' })).rejects.toThrow(/출력 제한/);
  });
  it('maps authentication errors without exposing response bodies or keys', async () => {
    const fetch = vi.fn(async () => new Response('secret diagnostic', { status: 401 }));
    const error = await new OpenAIRunner(fetch).handleRun({ instruction: '요약', content: '원문' }, { apiKey: 'sk-private', model: 'gpt-5-nano' }).then(() => new Error('expected failure'), value => value as Error);
    expect(error.message).toMatch(/API 키/);
    expect(error.message).not.toContain('secret diagnostic');
    expect(error.message).not.toContain('sk-private');
  });
  it('supports cancellation and timeout with AbortSignal', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const runner = new OpenAIRunner(fetch);
    const cancelled = runner.handleRun({ instruction: '요약', content: '원문' }, { apiKey: 'key', model: 'gpt-5-nano' });
    runner.handleCancel();
    await expect(cancelled).rejects.toThrow(/취소/);
    await expect(new OpenAIRunner(fetch).handleRun({ instruction: '요약', content: '원문' }, { apiKey: 'key', model: 'gpt-5-nano', timeoutMs: 10 })).rejects.toThrow(/시간/);
  });
});
