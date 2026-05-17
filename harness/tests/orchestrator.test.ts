import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedIntent } from '../src/types.js';

const parseMock = vi.hoisted(() => vi.fn());
const planMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());
const verifyMock = vi.hoisted(() => vi.fn());
const recoverMock = vi.hoisted(() => vi.fn());

vi.mock('../src/stages/parse.js', () => ({ parse: parseMock }));
vi.mock('../src/stages/plan.js', () => ({ plan: planMock }));
vi.mock('../src/stages/execute.js', () => ({ execute: executeMock }));
vi.mock('../src/stages/verify.js', () => ({ verify: verifyMock }));
vi.mock('../src/stages/recover.js', () => ({ recover: recoverMock }));

import { runGoal } from '../src/index.js';

const baseIntent: ParsedIntent = {
  action: 'launch-dlmm',
  params: { binStep: 10, seedAmount: 5 },
  network: 'devnet',
  ambiguities: [],
};

beforeEach(() => {
  parseMock.mockReset();
  planMock.mockReset();
  executeMock.mockReset();
  verifyMock.mockReset();
  recoverMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function collect(goal: string, maxRetries = 3) {
  const events: unknown[] = [];
  const iterator = runGoal(goal, { mcpBaseUrl: 'http://mcp', rpcUrl: 'http://rpc', maxRetries });
  while (true) {
    const step = await iterator.next();
    if (step.done) {
      return { events, result: step.value };
    }
    events.push(step.value);
  }
}

describe('runGoal', () => {
  it('emits the happy-path stage stream', async () => {
    parseMock.mockResolvedValue({ ok: true, value: baseIntent });
    planMock.mockResolvedValue({ ok: true, value: { binStep: 10, seedAmount: 5 } });
    executeMock.mockResolvedValue({ ok: true, value: { txHash: 'tx-1' } });
    verifyMock.mockResolvedValue({ ok: true, value: { txHash: 'tx-1', slot: 77, poolAddress: 'Pool1111111111111111111111111111111111111', confirmedAt: '2026-05-17T00:00:00.000Z' } });

    const { events, result } = await collect('launch goal');

    expect(events).toHaveLength(5);
    expect((events[0] as { stage: string }).stage).toBe('parse');
    expect((events[4] as { stage: string }).stage).toBe('done');
    expect(result).toEqual({ ok: true, value: { txHash: 'tx-1', slot: 77, poolAddress: 'Pool1111111111111111111111111111111111111', confirmedAt: '2026-05-17T00:00:00.000Z' } });
  });

  it('retries once after a retryable failure and then succeeds', async () => {
    parseMock.mockResolvedValue({ ok: true, value: baseIntent });
    planMock.mockImplementation(async (intent: ParsedIntent) => ({ ok: true, value: { binStep: intent.params.binStep, seedAmount: 5 } }));
    executeMock
      .mockResolvedValueOnce({ ok: false, error: 'blockhash not found', code: 'RPC_ERROR', retryable: true })
      .mockResolvedValueOnce({ ok: true, value: { txHash: 'tx-2' } });
    verifyMock.mockResolvedValue({ ok: true, value: { txHash: 'tx-2', slot: 88, confirmedAt: '2026-05-17T00:00:01.000Z' } });
    recoverMock.mockResolvedValue({ ok: true, value: { type: 'retry-from-plan', configPatch: { binStep: 20 } } });

    const { events, result } = await collect('launch goal');

    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(planMock).toHaveBeenCalledTimes(2);
    expect((planMock.mock.calls[1][0] as ParsedIntent).params.binStep).toBe(20);
    expect((events.filter((event) => typeof event === 'object') as Array<{ stage?: string }>).map((event) => event.stage)).toContain('recover');
    expect(result).toEqual({ ok: true, value: { txHash: 'tx-2', slot: 88, confirmedAt: '2026-05-17T00:00:01.000Z' } });
  });

  it('stops when the retry cap is reached', async () => {
    parseMock.mockResolvedValue({ ok: true, value: baseIntent });
    planMock.mockResolvedValue({ ok: true, value: { binStep: 10, seedAmount: 5 } });
    executeMock.mockResolvedValue({ ok: false, error: 'rpc error', code: 'RPC_ERROR', retryable: true });
    recoverMock.mockResolvedValue({ ok: true, value: { type: 'retry-from-plan', configPatch: { binStep: 30 } } });

    const { result } = await collect('launch goal', 1);

    expect(result).toEqual({ ok: false, code: 'RETRY_CAP_REACHED', error: 'retry cap reached', retryable: false });
  });

  it('aborts immediately for non-retryable failures', async () => {
    parseMock.mockResolvedValue({ ok: true, value: baseIntent });
    planMock.mockResolvedValue({ ok: true, value: { binStep: 10, seedAmount: 5 } });
    executeMock.mockResolvedValue({ ok: false, error: 'boom', code: 'UNKNOWN', retryable: false });
    recoverMock.mockResolvedValue({ ok: true, value: { type: 'abort', reason: 'boom' } });

    const { result } = await collect('launch goal');

    expect(result).toEqual({ ok: false, code: 'UNKNOWN', error: 'boom', retryable: false });
  });
});
