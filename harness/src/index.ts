import dotenv from 'dotenv';
import type { HarnessErrorCode, OnChainProof, ParsedIntent, StageEvent, StageResult } from './types.js';
import { parse } from './stages/parse.js';
import { plan } from './stages/plan.js';
import { execute } from './stages/execute.js';
import { verify } from './stages/verify.js';
import { recover } from './stages/recover.js';
import { deepClone, deepMerge } from './stages/shared.js';

dotenv.config();

type FailureResult = Extract<StageResult<OnChainProof>, { ok: false }>;

function now(): string {
  return new Date().toISOString();
}

function event(stage: StageEvent['stage'], status: StageEvent['status'], detail: unknown): StageEvent {
  return { ts: now(), stage, status, detail };
}

function failedResult(code: HarnessErrorCode, error: string, retryable: boolean): FailureResult {
  return { ok: false, code, error, retryable };
}

function exhaustedResult(): FailureResult {
  return { ok: false, code: 'RETRY_CAP_REACHED', error: 'retry cap reached', retryable: false };
}

function appendPatch(intent: ParsedIntent, patch: Record<string, unknown>): ParsedIntent {
  return { ...intent, params: deepMerge(deepClone(intent.params), patch) };
}

/** Runs the full Parse → Plan → Execute → Verify → Recover loop. */
export async function* runGoal(goal: string, opts: { mcpBaseUrl: string; rpcUrl: string; maxRetries: number }): AsyncGenerator<StageEvent, StageResult<OnChainProof>> {
  const parsed = await parse(goal);
  if (!parsed.ok) {
    yield event('parse', 'failed', parsed);
    return failedResult(parsed.code, parsed.error, parsed.retryable);
  }

  let currentIntent: ParsedIntent = parsed.value;
  yield event('parse', 'ok', currentIntent);

  let retryCount = 0;
  while (true) {
    const planned = await plan(currentIntent, opts.mcpBaseUrl);
    if (!planned.ok) {
      yield event('plan', 'failed', planned);
      const rec = await recover(planned, currentIntent, opts.mcpBaseUrl);
      if (!rec.ok) {
        yield event('done', 'failed', rec.error);
        return failedResult(rec.code, rec.error, rec.retryable);
      }
      if (rec.value.type === 'abort') {
        yield event('done', 'failed', rec.value.reason);
        return failedResult(planned.code, planned.error, planned.retryable);
      }
      yield event('recover', 'retrying', rec.value);
      retryCount += 1;
      if (retryCount >= opts.maxRetries) {
        const exhausted = exhaustedResult();
        yield event('done', 'failed', exhausted);
        return exhausted;
      }
      currentIntent = appendPatch(currentIntent, rec.value.configPatch);
      continue;
    }

    yield event('plan', 'ok', planned.value);

    const executed = await execute(currentIntent.action, planned.value, currentIntent.network);
    if (!executed.ok) {
      yield event('execute', 'failed', executed);
      const rec = await recover(executed, currentIntent, opts.mcpBaseUrl);
      if (!rec.ok) {
        yield event('done', 'failed', rec.error);
        return failedResult(rec.code, rec.error, rec.retryable);
      }
      if (rec.value.type === 'abort') {
        yield event('done', 'failed', rec.value.reason);
        return failedResult(executed.code, executed.error, executed.retryable);
      }
      yield event('recover', 'retrying', rec.value);
      retryCount += 1;
      if (retryCount >= opts.maxRetries) {
        const exhausted = exhaustedResult();
        yield event('done', 'failed', exhausted);
        return exhausted;
      }
      currentIntent = appendPatch(currentIntent, rec.value.configPatch);
      continue;
    }

    yield event('execute', 'ok', executed.value);

    const proof = await verify(executed.value.txHash, currentIntent.action, opts.rpcUrl);
    if (!proof.ok) {
      yield event('verify', 'failed', proof);
      const rec = await recover(proof, currentIntent, opts.mcpBaseUrl);
      if (!rec.ok) {
        yield event('done', 'failed', rec.error);
        return failedResult(rec.code, rec.error, rec.retryable);
      }
      if (rec.value.type === 'abort') {
        yield event('done', 'failed', rec.value.reason);
        return failedResult(proof.code, proof.error, proof.retryable);
      }
      yield event('recover', 'retrying', rec.value);
      retryCount += 1;
      if (retryCount >= opts.maxRetries) {
        const exhausted = exhaustedResult();
        yield event('done', 'failed', exhausted);
        return exhausted;
      }
      currentIntent = appendPatch(currentIntent, rec.value.configPatch);
      continue;
    }

    yield event('verify', 'ok', proof.value);
    yield event('done', 'ok', { summary: `${currentIntent.action} completed successfully`, proof: proof.value });
    return { ok: true, value: proof.value };
  }
}
