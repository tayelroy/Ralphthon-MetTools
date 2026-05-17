import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from '../src/stages/execute.js';

const execaMock = vi.hoisted(() => vi.fn());

vi.mock('execa', () => ({
  execa: execaMock,
}));

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const tempPath = path.join(repoRoot, 'meteora-invent', 'studio', 'config', 'harness_tmp_1111.jsonc');

beforeEach(() => {
  execaMock.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(1111);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('execute', () => {
  it('writes the temp config, extracts the tx hash, and deletes the temp file', async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 0, stdout: 'Signature: abc123', stderr: '' });

    const result = await execute('launch-dlmm', { binStep: 10, seedAmount: 5 }, 'devnet');

    expect(result).toEqual({ ok: true, value: { txHash: 'abc123' } });
    expect(existsSync(tempPath)).toBe(false);
    expect(execaMock).toHaveBeenCalledWith('node', ['--import', 'tsx', 'src/actions/dlmm/create_pool.ts', '--network', 'devnet'], expect.objectContaining({ cwd: expect.stringMatching(/meteora-invent\/studio$/), timeout: 120_000, reject: false }));
  });

  it('classifies insufficient SOL as a terminal error', async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'insufficient lamports for rent' });

    const result = await execute('launch-dlmm', { binStep: 10 }, 'devnet');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('INSUFFICIENT_SOL');
    expect(result.retryable).toBe(false);
    expect(existsSync(tempPath)).toBe(false);
  });

  it('classifies RPC timeout errors as retryable', async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'blockhash not found' });

    const result = await execute('swap', { amountIn: 1 }, 'devnet');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('RPC_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('classifies unknown errors conservatively', async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'something bizarre happened' });

    const result = await execute('swap', { amountIn: 1 }, 'devnet');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('UNKNOWN');
    expect(result.retryable).toBe(false);
  });
});
