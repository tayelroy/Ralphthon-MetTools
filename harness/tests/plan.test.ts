import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plan } from '../src/stages/plan.js';
import type { ParsedIntent } from '../src/types.js';

const createMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createMock,
      },
    };
  },
}));

beforeEach(() => {
  createMock.mockReset();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as const;
}

describe('plan', () => {
  it('returns a valid config when all params are already present', async () => {
    const intent: ParsedIntent = {
      action: 'launch-dlmm',
      params: { binStep: 25, seedAmount: 5, activeId: 12, tokenAMint: 'So11111111111111111111111111111111111111112', tokenBMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' },
      network: 'devnet',
      ambiguities: [],
    };

    const schema = {
      type: 'object',
      properties: {
        binStep: { type: 'number' },
        seedAmount: { type: 'number' },
        activeId: { type: 'number' },
        tokenAMint: { type: 'string' },
        tokenBMint: { type: 'string' },
      },
      required: ['binStep', 'seedAmount', 'activeId', 'tokenAMint', 'tokenBMint'],
      additionalProperties: true,
    };

    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ schema, example: intent.params }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await plan(intent, 'http://localhost:3000');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    expect(result.value.binStep).toBe(25);
  });

  it('resolves ambiguous params via the MCP server and LLM', async () => {
    const intent: ParsedIntent = {
      action: 'launch-dlmm',
      params: { seedAmount: 5, tokenAMint: 'So11111111111111111111111111111111111111112', tokenBMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' },
      network: 'devnet',
      ambiguities: ['binStep'],
    };

    const schema = {
      type: 'object',
      properties: {
        binStep: { type: 'number' },
        seedAmount: { type: 'number' },
        tokenAMint: { type: 'string' },
        tokenBMint: { type: 'string' },
      },
      required: ['binStep', 'seedAmount', 'tokenAMint', 'tokenBMint'],
      additionalProperties: true,
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ schema, example: { seedAmount: 5, tokenAMint: 'So11111111111111111111111111111111111111112', tokenBMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' } }))
      .mockResolvedValueOnce(jsonResponse({ explanation: 'binStep controls price granularity and bin spacing.' }));
    vi.stubGlobal('fetch', fetchMock);
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: '{"param":"binStep","value":10,"reason":"common DLMM bin spacing"}' } }] });

    const result = await plan(intent, 'http://localhost:3000');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.value.binStep).toBe(10);
    expect(result.value.seedAmount).toBe(5);
  });

  it('fills launch-dlmm defaults from env and nested token metadata', async () => {
    const intent: ParsedIntent = {
      action: 'launch-dlmm',
      params: {
        tokenA: 'SOL',
        tokenB: {
          name: 'MetTools',
          symbol: 'TOOL',
          decimals: 6,
          supply: 1000000,
          description: 'Hackathon token',
        },
        binStep: 10,
        seedAmount: 2,
        initialPrice: 0.01,
      },
      network: 'devnet',
      ambiguities: [],
    };

    const schema = {
      type: 'object',
      properties: {
        rpcUrl: { type: 'string' },
        dryRun: { type: 'boolean' },
        keypairFilePath: { type: 'string' },
        computeUnitPriceMicroLamports: { type: 'integer' },
        quoteMint: { type: 'string' },
        createBaseToken: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            symbol: { type: 'string' },
            decimals: { type: 'integer' },
            supply: { type: 'integer' },
            metadata: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                image: { type: 'string' },
                website: { type: 'string' },
                twitter: { type: 'string' },
                telegram: { type: 'string' },
              },
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        dlmmConfig: {
          type: 'object',
          properties: {
            binStep: { type: 'integer' },
            initialPrice: { type: 'number' },
          },
          additionalProperties: true,
        },
        singleBinSeedLiquidity: {
          type: 'object',
          properties: {
            price: { type: 'number' },
            seedAmount: { type: 'string' },
            operatorKeypairFilepath: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      required: ['rpcUrl', 'dryRun', 'keypairFilePath', 'computeUnitPriceMicroLamports', 'quoteMint'],
      additionalProperties: true,
    };

    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ schema, example: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await plan(intent, 'http://localhost:3000');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.quoteMint).toBe('So11111111111111111111111111111111111111112');
    expect(result.value.keypairFilePath).toBe('./keypair.json');
    expect((result.value.createBaseToken as Record<string, unknown>).name).toBe('MetTools');
    expect((result.value.createBaseToken as Record<string, unknown>).symbol).toBe('TOOL');
    expect(((result.value.createBaseToken as Record<string, unknown>).metadata as Record<string, unknown>).description).toBe('Hackathon token');
    expect(((result.value.singleBinSeedLiquidity as Record<string, unknown>).seedAmount)).toBe('2');
    expect(((result.value.dlmmConfig as Record<string, unknown>).binStep)).toBe(10);
  });

  it('returns INVALID_CONFIG when the merged config fails schema validation', async () => {
    const intent: ParsedIntent = {
      action: 'launch-dlmm',
      params: {},
      network: 'devnet',
      ambiguities: [],
    };

    const schema = {
      type: 'object',
      properties: {
        binStep: { type: 'number' },
      },
      required: ['binStep'],
      additionalProperties: false,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ schema, example: {} })));

    const result = await plan(intent, 'http://localhost:3000');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('INVALID_CONFIG');
    expect(result.retryable).toBe(true);
  });
});
