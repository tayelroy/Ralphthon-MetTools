import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionState = vi.hoisted(() => ({
  getSignatureStatus: vi.fn(),
  confirmTransaction: vi.fn(),
  getParsedTransaction: vi.fn(),
}));

vi.mock('../src/lib/solana.js', () => ({
  createConnection: vi.fn(() => connectionState),
}));

let verify: typeof import('../src/stages/verify.js').verify;

beforeAll(async () => {
  ({ verify } = await import('../src/stages/verify.js'));
});

beforeEach(() => {
  connectionState.getSignatureStatus.mockReset();
  connectionState.confirmTransaction.mockReset();
  connectionState.getParsedTransaction.mockReset();
  vi.stubGlobal('setTimeout', ((callback: any) => {
    if (typeof callback === 'function') callback();
    return 0 as never;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verify', () => {
  it('returns proof when the transaction confirms immediately', async () => {
    connectionState.getSignatureStatus.mockResolvedValue({ value: { confirmationStatus: 'confirmed' } });
    connectionState.confirmTransaction.mockResolvedValue({ value: { err: null } });
    connectionState.getParsedTransaction.mockResolvedValue({
      slot: 123,
      meta: { logMessages: ['Program log: Pool: 12345678901234567890123456789012'] },
    });

    const result = await verify('tx-1', 'launch-dlmm', 'http://rpc');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.txHash).toBe('tx-1');
    expect(result.value.slot).toBe(123);
    expect(result.value.poolAddress).toBe('12345678901234567890123456789012');
    expect(connectionState.confirmTransaction).toHaveBeenCalledOnce();
    expect(connectionState.getParsedTransaction).toHaveBeenCalledOnce();
  });

  it('keeps polling until confirmation appears', async () => {
    connectionState.getSignatureStatus
      .mockResolvedValueOnce({ value: { confirmationStatus: 'processed' } })
      .mockResolvedValueOnce({ value: { confirmationStatus: 'processed' } })
      .mockResolvedValueOnce({ value: { confirmationStatus: 'confirmed' } });
    connectionState.confirmTransaction.mockResolvedValue({ value: { err: null } });
    connectionState.getParsedTransaction.mockResolvedValue({ slot: 456, meta: { logMessages: [] } });

    const result = await verify('tx-2', 'launch-dlmm', 'http://rpc');

    expect(result.ok).toBe(true);
    expect(connectionState.getSignatureStatus).toHaveBeenCalledTimes(3);
  });

  it('returns RPC_ERROR when confirmation does not arrive in time', async () => {
    connectionState.getSignatureStatus.mockResolvedValue({ value: { confirmationStatus: 'processed' } });

    const result = await verify('tx-3', 'launch-dlmm', 'http://rpc');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('RPC_ERROR');
    expect(connectionState.confirmTransaction).not.toHaveBeenCalled();
    expect(connectionState.getParsedTransaction).not.toHaveBeenCalled();
  });
});
