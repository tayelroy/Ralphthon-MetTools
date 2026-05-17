import { describe, expect, it, vi } from 'vitest';
import { createExecuteGoalHandler } from '../src/tools/execute-goal.js';

describe('createExecuteGoalHandler', () => {
  it('streams stage events and a final done event as SSE', async () => {
    const runGoal = vi.fn(async function* () {
      yield { ts: '2026-05-17T00:00:00.000Z', stage: 'parse', status: 'ok', detail: { action: 'launch-dlmm' } };
      yield { ts: '2026-05-17T00:00:01.000Z', stage: 'plan', status: 'ok', detail: { binStep: 10 } };
      return { ok: true, value: { txHash: 'abc123', slot: 42, confirmedAt: '2026-05-17T00:00:02.000Z' } };
    });

    const chunks: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => {
        chunks.push(chunk);
        return true;
      }),
      end: vi.fn(),
    };

    const handler = createExecuteGoalHandler(runGoal as never);
    await handler('test goal', res as never);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();

    const joined = chunks.join('');
    expect(joined).toContain('data: {"ts":"2026-05-17T00:00:00.000Z","stage":"parse","status":"ok"');
    expect(joined).toContain('data: {"ts":"2026-05-17T00:00:01.000Z","stage":"plan","status":"ok"');
    expect(joined).toContain('event: done');
    expect(joined).toContain('"txHash":"abc123"');
  });
});
