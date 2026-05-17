import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import type { HarnessErrorCode, MetsumiConfig, StageResult } from '../types.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const configFileByAction: Record<string, string> = {
  'launch-dlmm': 'dlmm_config.jsonc',
  'launch-dbc': 'dbc_config.jsonc',
  swap: 'dbc_config.jsonc',
};
const scriptByAction: Record<string, string> = {
  'launch-dlmm': 'dlmm-create-pool',
  'launch-dbc': 'dbc-create-pool',
  swap: 'dbc-swap',
};
const entrypointByAction: Record<string, string> = {
  'launch-dlmm': 'src/actions/dlmm/create_pool.ts',
  'launch-dbc': 'src/actions/dbc/create_pool.ts',
  swap: 'src/actions/dbc/swap.ts',
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function resolvePathLike(value: unknown, baseDir: string): string | undefined {
  return typeof value === 'string' && value.length > 0 ? path.resolve(baseDir, value) : undefined;
}

function classifyError(stderr: string): { code: HarnessErrorCode; retryable: boolean } {

  const text = stderr.toLowerCase();
  if (text.includes('insufficient lamports') || text.includes('insufficient funds')) return { code: 'INSUFFICIENT_SOL', retryable: false };
  if (text.includes('blockhash not found') || text.includes('timed out') || text.includes('connection refused')) return { code: 'RPC_ERROR', retryable: true };
  if (text.includes('invalid account data') || text.includes('invalid config')) return { code: 'INVALID_CONFIG', retryable: true };
  return { code: 'UNKNOWN', retryable: false };
}

/** Executes the meteora-invent CLI with a temporary JSONC config file. */
export async function execute(action: string, config: MetsumiConfig, network: string): Promise<StageResult<{ txHash: string }>> {
  const tempPath = path.join(repoRoot, 'meteora-invent', 'studio', 'config', `harness_tmp_${Date.now()}.jsonc`);
  const targetConfigPath = path.join(repoRoot, 'meteora-invent', 'studio', 'config', configFileByAction[action] ?? 'dlmm_config.jsonc');
  let originalTargetContent: string | undefined;
  try {
    const normalizedConfig: MetsumiConfig = JSON.parse(JSON.stringify(config)) as MetsumiConfig;
    normalizedConfig.keypairFilePath = resolvePathLike(normalizedConfig.keypairFilePath as unknown, repoRoot) ?? path.resolve(repoRoot, './keypair.json');
    const singleBinSeedLiquidity = asRecord(normalizedConfig.singleBinSeedLiquidity as unknown);
    if (singleBinSeedLiquidity) {
      const resolved = resolvePathLike(singleBinSeedLiquidity.operatorKeypairFilepath, repoRoot);
      if (resolved) singleBinSeedLiquidity.operatorKeypairFilepath = resolved;
    }
    const lfgSeedLiquidity = asRecord(normalizedConfig.lfgSeedLiquidity as unknown);
    if (lfgSeedLiquidity) {
      const resolved = resolvePathLike(lfgSeedLiquidity.operatorKeypairFilepath, repoRoot);
      if (resolved) lfgSeedLiquidity.operatorKeypairFilepath = resolved;
    }

    const fileContent = `// agent-generated config\n${JSON.stringify(normalizedConfig, null, 2)}\n`;
    await fs.writeFile(tempPath, fileContent, 'utf8');
    originalTargetContent = await fs.readFile(targetConfigPath, 'utf8');
    await fs.writeFile(targetConfigPath, fileContent, 'utf8');

    const result = await execa('node', ['--import', 'tsx', entrypointByAction[action] ?? 'src/actions/dlmm/create_pool.ts', '--network', network], {
      cwd: path.join(repoRoot, 'meteora-invent', 'studio'),
      timeout: 120_000,
      reject: false,
    });

    if (result.exitCode !== 0) {
      const classified = classifyError(result.stderr || result.stdout || 'execution failed');
      return { ok: false, error: result.stderr || 'execution failed', code: classified.code, retryable: classified.retryable };
    }

    const txHashMatch = result.stdout.match(/(?:Transaction|Signature):\s*([A-Za-z0-9]+)/);
    if (!txHashMatch) {
      return { ok: false, error: `unable to extract tx hash from stdout: ${result.stdout}`, code: 'EXECUTE_FAILED', retryable: false };
    }

    return { ok: true, value: { txHash: txHashMatch[1] } };
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    const classified = classifyError(stderr);
    return { ok: false, error: stderr, code: classified.code, retryable: classified.retryable };
  } finally {
    if (originalTargetContent !== undefined) {
      await fs.writeFile(targetConfigPath, originalTargetContent, 'utf8');
    } else {
      await fs.rm(targetConfigPath, { force: true });
    }
    await fs.rm(tempPath, { force: true });
  }
}
