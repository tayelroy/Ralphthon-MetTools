/** All recoverable and terminal error codes used by the harness. */
export type HarnessErrorCode =
  | 'PARSE_FAILED'
  | 'PLAN_FAILED'
  | 'EXECUTE_FAILED'
  | 'VERIFY_FAILED'
  | 'RECOVER_FAILED'
  | 'RETRY_CAP_REACHED'
  | 'INSUFFICIENT_SOL'
  | 'INVALID_CONFIG'
  | 'RPC_ERROR'
  | 'UNKNOWN';

/** Generic stage result with a success or failure branch. */
export type StageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: HarnessErrorCode; retryable: boolean };

/** Parsed user intent extracted from a natural-language goal. */
export type ParsedIntent = {
  action: 'launch-dlmm' | 'launch-dbc' | 'swap';
  params: Record<string, unknown>;
  network: 'devnet' | 'mainnet-beta';
  ambiguities: string[];
};

/** The config object passed to meteora-invent. */
export type MetsumiConfig = Record<string, unknown>;

/** Proof of a confirmed on-chain action. */
export type OnChainProof = {
  txHash: string;
  slot: number;
  poolAddress?: string;
  confirmedAt: string;
};

/** The harness recovery decision after a failed stage. */
export type RecoveryAction =
  | { type: 'retry-from-plan'; configPatch: Record<string, unknown> }
  | { type: 'abort'; reason: string };

/** A streamed stage update emitted by the orchestrator. */
export type StageEvent = {
  ts: string;
  stage: 'parse' | 'plan' | 'execute' | 'verify' | 'recover' | 'done';
  status: 'ok' | 'failed' | 'retrying';
  detail: unknown;
};
