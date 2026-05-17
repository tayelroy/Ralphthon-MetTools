import type { Response } from 'express';
import { withSource } from './shared.js';

export type OnChainProof = {
  txHash: string;
  slot: number;
  poolAddress?: string;
  confirmedAt: string;
};

export type StageEvent = {
  ts: string;
  stage: 'parse' | 'plan' | 'execute' | 'verify' | 'recover' | 'done';
  status: 'ok' | 'failed' | 'retrying';
  detail: unknown;
};

export type StageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: string; retryable: boolean };

export type RunGoalFn = (
  goal: string,
  opts: { mcpBaseUrl: string; rpcUrl: string; maxRetries: number },
) => AsyncGenerator<StageEvent, StageResult<OnChainProof>>;

async function loadRunGoal(): Promise<RunGoalFn> {
  const modulePath = ['..', '..', '..', 'harness', 'src', 'index.ts'].join('/');
  const moduleUrl = new URL(modulePath, import.meta.url);
  const mod = await import(moduleUrl.href) as { runGoal: RunGoalFn };
  return mod.runGoal;
}

/** Streams the harness execution loop as server-sent events. */
export function createExecuteGoalHandler(runGoalOverride?: RunGoalFn) {
  return async function executeGoal(goal: string, res: Response): Promise<void> {
    const runGoal = runGoalOverride ?? await loadRunGoal();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const iterator = runGoal(goal, {
      mcpBaseUrl: process.env.MCP_BASE_URL ?? 'http://localhost:3000',
      rpcUrl: process.env.RPC_URL ?? 'https://api.devnet.solana.com',
      maxRetries: Number(process.env.MAX_RETRIES ?? '3'),
    });

    while (true) {
      const step = await iterator.next();
      if (step.done) {
        const finalValue = step.value as StageResult<OnChainProof>;
        const payload = finalValue.ok ? finalValue.value : finalValue;
        res.write('event: done\n');
        res.write(`data: ${JSON.stringify(withSource({ result: payload }, 'https://docs.meteora.ag/developer-guide/home'))}\n\n`);
        res.end();
        return;
      }

      const event = step.value as StageEvent;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
}
