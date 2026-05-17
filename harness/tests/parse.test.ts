import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { parse } from '../src/stages/parse.js';

beforeEach(() => {
  createMock.mockReset();
});

describe('parse', () => {
  it('extracts a full intent', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"action":"launch-dlmm","params":{"binStep":10,"seedAmount":5},"network":"devnet","ambiguities":["activeId"]}' } }],
    });

    const result = await parse('Launch a DLMM pool for SOL/USDC, bin step 10, seed 5 SOL, devnet');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.action).toBe('launch-dlmm');
    expect(result.value.params.binStep).toBe(10);
    expect(result.value.params.seedAmount).toBe(5);
    expect(result.value.network).toBe('devnet');
    expect(result.value.ambiguities).toEqual(['activeId']);
  });

  it('extracts partial intent with ambiguities', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"action":"launch-dbc","params":{"feeBps":100},"network":"mainnet-beta","ambiguities":["migrationThreshold","quoteMint"]}' } }],
    });

    const result = await parse('Launch a DBC pool with 1% fee on mainnet-beta');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.action).toBe('launch-dbc');
    expect(result.value.params.feeBps).toBe(100);
    expect(result.value.network).toBe('mainnet-beta');
    expect(result.value.ambiguities).toEqual(['migrationThreshold', 'quoteMint']);
  });

  it('returns PARSE_FAILED for unsupported actions', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"error":"unsupported action"}' } }],
    });

    const result = await parse('Launch an unrelated thing');

    expect(result).toEqual({ ok: false, error: 'unsupported action', code: 'PARSE_FAILED', retryable: false });
  });

  it('returns PARSE_FAILED for malformed JSON', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'not valid json' } }],
    });

    const result = await parse('Launch a DLMM pool');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('PARSE_FAILED');
  });
});
