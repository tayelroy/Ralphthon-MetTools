import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunGoalFn } from '../src/tools/execute-goal.js';

const llmsText = `# Meteora Documentation

## Docs

- [Overview](https://docs.meteora.ag/developer-guide/home.md)
- [DLMM Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md): Configure and Launch a DLMM Pool on Meteora using nothing but a configuration file and a few CLI commands
`;

const pages: Record<string, string> = {
  'https://docs.meteora.ag/developer-guide/home.md': ['# Overview', '', 'Meteora docs home.'].join('\n'),
  'https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md': [
    '# DLMM Launch Pool',
    '',
    '| Field | Type | Description | Example |',
    '| --- | --- | --- | --- |',
    '| binStep | integer | Price increment/decrement percentage in basis points. | 25 |',
    '| seedAmount | string | Total amount of liquidity to seed into the pool. | 200000 |',
    '| activeId | integer | Bin index for the initial active price. | 0 |',
  ].join('\n'),
};

let server: ReturnType<typeof createServer> | undefined;
let nativeFetch: typeof fetch | undefined;

function makeFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = pages[url] ?? llmsText;
    const status = pages[url] || url === 'https://docs.meteora.ag/llms.txt' ? 200 : 404;
    return new Response(body, {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  });
}

async function startApp(runGoal?: RunGoalFn) {
  vi.resetModules();
  nativeFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal('fetch', makeFetchMock());

  const { createApp } = await import('../src/index.js');
  const app = await createApp(runGoal ? { runGoal } : {});
  server = createServer(app as never);
  await new Promise<void>((resolve) => server?.listen(0, resolve));

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to start test server');
  }

  return { port: address.port };
}

async function stopApp() {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(async () => {
  await stopApp();
  vi.unstubAllGlobals();
});

describe('MCP server routes', () => {
  it('exposes docs-backed action schemas through POST /tools/meteora_get_action_schema', async () => {
    const { port } = await startApp();
    const response = await nativeFetch?.(`http://127.0.0.1:${port}/tools/meteora_get_action_schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'launch-dlmm' }),
    });

    expect(response?.ok).toBe(true);
    const body = await response?.json() as {
      action: string;
      sourceUrl: string;
      configFields: Array<{ name: string; type: string; description: string; required: boolean }>;
    };

    expect(body.action).toBe('launch-dlmm');
    expect(body.sourceUrl).toBe('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md');
    expect(body.configFields.some((field) => field.name === 'binStep' && field.type === 'integer')).toBe(true);
    expect(body.configFields.some((field) => field.name === 'seedAmount' && field.required)).toBe(false);
  });

  it('returns docs-backed parameter guidance through POST /tools/meteora_resolve_param', async () => {
    const { port } = await startApp();
    const response = await nativeFetch?.(`http://127.0.0.1:${port}/tools/meteora_resolve_param`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'launch-dlmm', param: 'binStep' }),
    });

    expect(response?.ok).toBe(true);
    const body = await response?.json() as { explanation: string; sourceUrl: string; validValues?: string[] };

    expect(body.explanation).toContain('price granularity');
    expect(body.sourceUrl).toBe('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md');
    expect(body.validValues).toContain('10');
  });

  it('streams stage events and final proof through POST /tools/meteora_execute_goal', async () => {
    const runGoal = vi.fn(async function* () {
      yield { ts: '2026-05-17T00:00:00.000Z', stage: 'parse', status: 'ok', detail: { action: 'launch-dlmm', ambiguities: ['binStep'] } };
      yield { ts: '2026-05-17T00:00:01.000Z', stage: 'plan', status: 'ok', detail: { binStep: 10, seedAmount: 5 } };
      return {
        ok: true,
        value: {
          txHash: '5xK3j111111111111111111111111111111111111',
          slot: 42,
          poolAddress: 'Pool1111111111111111111111111111111111111',
          confirmedAt: '2026-05-17T00:00:02.000Z',
        },
      };
    });

    const { port } = await startApp(runGoal as never);
    const response = await nativeFetch?.(`http://127.0.0.1:${port}/tools/meteora_execute_goal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Launch a DLMM pool for SOL with reasonable defaults on devnet' }),
    });

    expect(response?.ok).toBe(true);
    expect(response?.headers.get('content-type')).toContain('text/event-stream');

    const text = await response?.text();
    expect(text).toContain('data: {"ts":"2026-05-17T00:00:00.000Z","stage":"parse","status":"ok"');
    expect(text).toContain('data: {"ts":"2026-05-17T00:00:01.000Z","stage":"plan","status":"ok"');
    expect(text).toContain('event: done');
    expect(text).toContain('"txHash":"5xK3j111111111111111111111111111111111111"');
    expect(text).toContain('"source":"https://docs.meteora.ag/developer-guide/home"');
    expect(runGoal).toHaveBeenCalledWith('Launch a DLMM pool for SOL with reasonable defaults on devnet', expect.objectContaining({
      mcpBaseUrl: 'http://localhost:3000',
      rpcUrl: 'https://api.devnet.solana.com',
      maxRetries: 3,
    }));
  });
});
