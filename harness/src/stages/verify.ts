import { createConnection } from '../lib/solana.js';
import type { OnChainProof, StageResult } from '../types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPoolAddress(logs: string[] | null | undefined): string | undefined {
  if (!logs) return undefined;
  for (const line of logs) {
    const match = line.match(/Pool:\s*([A-Za-z0-9]{32,44})/);
    if (match) return match[1];
  }
  return undefined;
}

/** Confirms a transaction and extracts its created pool address from logs. */
export async function verify(txHash: string, _action: string, rpcUrl: string): Promise<StageResult<OnChainProof>> {
  try {
    const connection = createConnection(rpcUrl);
    const maxAttempts = 15;
    let confirmed = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const status = await connection.getSignatureStatus(txHash, { searchTransactionHistory: true });
      if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
        confirmed = true;
        break;
      }
      await sleep(2_000);
    }

    if (!confirmed) {
      return { ok: false, error: 'transaction was not confirmed within 30s', code: 'RPC_ERROR', retryable: true };
    }

    const confirmedTx = await connection.confirmTransaction(txHash, 'confirmed');
    if (confirmedTx.value.err) {
      return { ok: false, error: 'transaction not confirmed', code: 'RPC_ERROR', retryable: true };
    }

    const parsed = await connection.getParsedTransaction(txHash, { maxSupportedTransactionVersion: 0 });
    if (!parsed) {
      return { ok: false, error: 'missing parsed transaction', code: 'RPC_ERROR', retryable: true };
    }

    const poolAddress = extractPoolAddress(parsed.meta?.logMessages);
    return {
      ok: true,
      value: {
        txHash,
        slot: parsed.slot,
        poolAddress,
        confirmedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'verify failure';
    console.error('[verify]', message);
    return {
      ok: false,
      error: message,
      code: 'VERIFY_FAILED',
      retryable: true,
    };
  }
}
