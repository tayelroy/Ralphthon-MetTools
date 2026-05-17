import OpenAI from 'openai';
import type { ParsedIntent, RecoveryAction, StageResult, HarnessErrorCode } from '../types.js';

function createClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/** Classifies a failed stage result into either a retry action or an abort. */
export async function recover(failed: { error: string; code: HarnessErrorCode; retryable: boolean }, intent: ParsedIntent, _mcpBaseUrl: string): Promise<StageResult<RecoveryAction>> {
  if (failed.code === 'INSUFFICIENT_SOL') {
    return { ok: true, value: { type: 'abort', reason: 'wallet has insufficient SOL; refill required' } };
  }
  if (failed.code === 'RETRY_CAP_REACHED') return { ok: true, value: { type: 'abort', reason: 'retry cap reached' } };
  if (!failed.retryable) {
    return { ok: true, value: { type: 'abort', reason: failed.error } };
  }
  if (failed.code === 'RPC_ERROR') return { ok: true, value: { type: 'retry-from-plan', configPatch: {} } };
  if (failed.code === 'INVALID_CONFIG') {
    try {
      const client = createClient();
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Suggest a corrected Meteora config value. Return only JSON: { "param": string, "value": unknown, "reason": string }.' },
          { role: 'user', content: JSON.stringify({ failed, intent }) },
        ],
        temperature: 0,
      });
      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content) as { param?: string; value?: unknown };
        if (parsed.param) return { ok: true, value: { type: 'retry-from-plan', configPatch: { [parsed.param]: parsed.value } } };
      }
    } catch {
      // fall through to a generic retry suggestion
    }
    return { ok: true, value: { type: 'retry-from-plan', configPatch: {} } };
  }
  return { ok: true, value: { type: 'abort', reason: failed.error } };
}
