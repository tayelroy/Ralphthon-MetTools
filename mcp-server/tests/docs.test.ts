import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const llmsText = `# Meteora Documentation

## Docs

- [Overview](https://docs.meteora.ag/developer-guide/home.md)
- [DLMM Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md): Configure and Launch a DLMM Pool on Meteora using nothing but a configuration file and a few CLI commands
- [DAMM v1 Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/damm-v1-launch-pool.md): Configure and Launch a DAMM v1 Pool on Meteora using nothing but a configuration file and a few CLI commands
- [DAMM v2 Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/damm-v2-launch-pool.md): Configure and Launch a DAMM v2 Pool on Meteora using nothing but a configuration file and a few CLI commands
- [DBC Token Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/dbc-token-launch-pool.md): Configure and Launch a DBC Token Pool on Meteora using nothing but a configuration file and a few CLI commands
`;

const pages: Record<string, string> = {
  'https://docs.meteora.ag/developer-guide/home.md': ['# Overview', '', 'Meteora docs home.'].join('\n'),
  'https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md': [
    '> ## Documentation Index',
    '> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt',
    '',
    '# DLMM Launch Pool',
    '',
    '> Configure and Launch a DLMM Pool on Meteora using nothing but a configuration file and a few CLI commands',
    '',
    '```jsonc dlmm_config.jsonc theme={"system"}',
    '{',
    '  /* rpcUrl is required. You can switch between mainnet, devnet and localnet or use your own RPC URL. */',
    '  "rpcUrl": "https://api.devnet.solana.com",',
    '  "dlmmConfig": {',
    '    "binStep": 25, // Price increment/decrement percentage in basis points (400 = 4% price step between bins)',
    '    "feeBps": 1, // Trading fee in basis points (200 = 2% fee per swap)',
    '    "initialPrice": 1.333, // Initial price(in terms of quote/base price)',
    '    "activationType": 1, // 0 - Slot | 1 - Timestamp',
    '    "activationPoint": null',
    '  }',
    '}',
    '```',
  ].join('\n'),
  'https://docs.meteora.ag/developer-guide/quick-launch/damm-v1-launch-pool.md': [
    '# DAMM v1 Launch Pool',
    '',
    '```jsonc damm_v1_config.jsonc theme={"system"}',
    '{',
    '  /* quoteMint is required for the following actions:',
    '  * 1. damm-v1-create-pool',
    '  * 2. damm-v1-lock-liquidity',
    '  */',
    '  "quoteMint": "So11111111111111111111111111111111111111112",',
    '  "dammV1Config": {',
    '    "baseAmount": 100, // base token amount',
    '    "quoteAmount": 0.001, // quote token amount',
    '    "tradeFeeNumerator": 2500, // pool fee in bps',
    '    "activationType": 1',
    '  }',
    '}',
    '```',
  ].join('\n'),
  'https://docs.meteora.ag/developer-guide/quick-launch/damm-v2-launch-pool.md': [
    '# DAMM v2 Launch Pool',
    '',
    '```jsonc damm_v2_config.jsonc theme={"system"}',
    '{',
    '  /* quoteMint is required for the following actions:',
    '  * 1. damm-v2-create-balanced-pool',
    '  * 2. damm-v2-create-one-sided-pool',
    '  */',
    '  "quoteMint": "So11111111111111111111111111111111111111112",',
    '  "dammV2Config": {',
    '    "creator": "YOUR_CREATOR_ADDRESS", // creator address',
    '    "baseAmount": 100000000, // base token amount',
    '    "quoteAmount": null,',
    '    "initPrice": 0.001, // initial price (in terms of quote/base price)',
    '    "poolFees": {',
    '      "minBaseFeeBps": 120,',
    '      "useDynamicFee": true',
    '    }',
    '  }',
    '}',
    '```',
  ].join('\n'),
  'https://docs.meteora.ag/developer-guide/quick-launch/dbc-token-launch-pool.md': [
    '# DBC Token Launch Pool',
    '',
    '```jsonc dbc_config.jsonc theme={"system"}',
    '{',
    '  /* quoteMint is required for the following actions:',
    '  * 1. dbc-create-config',
    '  * 2. dbc-create-pool (if there is no configKeyAddress)',
    '  */',
    '  "quoteMint": "So11111111111111111111111111111111111111112",',
    '  "dbcConfig": {',
    '    "buildCurveMode": 0, // 0 - buildCurve | 1 - buildCurveWithMarketCap',
    '    "percentageSupplyOnMigration": 20, // percentage of total token supply to be migrated',
    '    "migrationQuoteThreshold": 10, // migration quote threshold needed to migrate the DBC token pool',
    '    "token": {',
    '      "totalTokenSupply": 1000000000,',
    '      "tokenBaseDecimal": 6,',
    '      "tokenQuoteDecimal": 9',
    '    }',
    '  }',
    '}',
    '```',
  ].join('\n'),
};

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

async function loadTools() {
  vi.resetModules();
  const fetchMock = makeFetchMock();
  vi.stubGlobal('fetch', fetchMock);

  const [{ createApp }, { listDocs }, { getDoc }, { searchDocs }, { getActionSchema }] = await Promise.all([
    import('../src/index.js'),
    import('../src/tools/list-docs.js'),
    import('../src/tools/get-doc.js'),
    import('../src/tools/search-docs.js'),
    import('../src/tools/action-schema.js'),
  ]);

  return { createApp, listDocs, getDoc, searchDocs, getActionSchema, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const listSchema = z.object({
  source: z.string().min(1),
  pages: z.array(z.object({ title: z.string(), url: z.string().url() })),
});

const docSchema = z.object({
  source: z.string().min(1),
  title: z.string(),
  url: z.string().url(),
  content: z.string(),
});

const searchSchema = z.object({
  source: z.string().min(1),
  results: z.array(z.object({ title: z.string(), url: z.string().url(), excerpt: z.string() })),
});

const actionSchema = z.object({
  source: z.string().min(1),
  action: z.enum(['launch-dlmm', 'launch-dbc', 'launch-damm-v1', 'launch-damm-v2']),
  sourceUrl: z.string().url(),
  configFields: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
    required: z.boolean(),
  })),
});

describe('docs-driven MCP tools', () => {
  it('lists the docs index and filters by keyword', async () => {
    const { listDocs } = await loadTools();

    const result = await listDocs('launch pool');
    const parsed = listSchema.parse(result);

    expect(parsed.source).toBe('https://docs.meteora.ag/llms.txt');
    expect(parsed.pages).toHaveLength(4);
    expect(parsed.pages.map((page) => page.title)).toContain('DLMM Launch Pool');
  });

  it('fetches a doc page as markdown and normalizes the .md url', async () => {
    const { getDoc } = await loadTools();

    const result = await getDoc('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool');
    const parsed = docSchema.parse(result);

    expect(parsed.url).toBe('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md');
    expect(parsed.title).toBe('DLMM Launch Pool');
    expect(parsed.content).toContain('Configure and Launch a DLMM Pool on Meteora');
  });

  it('searches cached pages for content and uncached pages for titles only', async () => {
    const { getDoc, searchDocs } = await loadTools();

    const before = searchSchema.parse(await searchDocs('binStep'));
    expect(before.results).toHaveLength(0);

    await getDoc('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool');
    const after = searchSchema.parse(await searchDocs('binStep'));

    expect(after.results).toHaveLength(1);
    expect(after.results[0]?.title).toBe('DLMM Launch Pool');
    expect(after.results[0]?.excerpt).toContain('binStep');

    const titleHit = searchSchema.parse(await searchDocs('DBC'));
    expect(titleHit.results.map((result) => result.title)).toContain('DBC Token Launch Pool');
  });

  it('derives config fields from the quick-launch docs', async () => {
    const { getActionSchema } = await loadTools();

    const result = await getActionSchema('launch-dlmm');
    const parsed = actionSchema.parse(result);

    expect(parsed.sourceUrl).toBe('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md');
    expect(parsed.configFields.find((field) => field.name === 'rpcUrl')?.required).toBe(true);
    expect(parsed.configFields.find((field) => field.name === 'dlmmConfig.binStep')?.type).toBe('integer');
    expect(parsed.configFields.find((field) => field.name === 'dlmmConfig.binStep')?.description).toContain('price step');
  });
});
