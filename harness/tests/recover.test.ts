import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recover } from '../src/stages/recover.js';

const createMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createMock,
      },
    };
  },
}));

beforeEach(() => {
  createMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recover', () => {
  it('aborts immediately for insufficient SOL', async () => {
    const result = await recover({ error: 'insufficient funds', code: 'INSUFFICIENT_SOL', retryable: false }, { action: 'launch-dlmm', params: {}, network: 'devnet', ambiguities: [] }, 'http://mcp');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toEqual({ type: 'abort', reason: 'wallet has insufficient SOL; refill required' });
  });

  it('retries from plan for RPC errors', async () => {
    const result = await recover({ error: 'blockhash not found', code: 'RPC_ERROR', retryable: true }, { action: 'launch-dlmm', params: {}, network: 'devnet', ambiguities: [] }, 'http://mcp');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toEqual({ type: 'retry-from-plan', configPatch: {} });
  });

  it('asks the LLM for a corrected value on invalid config', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: '{"param":"binStep","value":5,"reason":"smaller bin step"}' } }] });

    const result = await recover({ error: 'invalid config: binStep', code: 'INVALID_CONFIG', retryable: true }, { action: 'launch-dlmm', params: { binStep: 10 }, network: 'devnet', ambiguities: [] }, 'http://mcp');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toEqual({ type: 'retry-from-plan', configPatch: { binStep: 5 } });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('aborts when the error is not retryable', async () => {
    const result = await recover({ error: 'boom', code: 'UNKNOWN', retryable: false }, { action: 'swap', params: {}, network: 'devnet', ambiguities: [] }, 'http://mcp');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toEqual({ type: 'abort', reason: 'boom' });
  });
});
