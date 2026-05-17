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
    '# DLMM Launch Pool',
    '',
    '| Field | Type | Description | Example |',
    '| --- | --- | --- | --- |',
    '| rpcUrl | string | RPC URL is required. You can switch between mainnet, devnet and localnet or use your own RPC URL. | https://api.devnet.solana.com |',
    '| binStep | integer | Price increment/decrement percentage in basis points (400 = 4% price step between bins). | 25 |',
    '| feeBps | integer | Trading fee in basis points. | 1 |',
    '| initialPrice | number | Initial price in terms of quote/base price. | 1.333 |',
    '| seedAmount | string | Total amount of liquidity to seed into the pool (in token units). | 200000 |',
    '',
    'Some additional prose below the table.',
  ].join('\n'),
  'https://docs.meteora.ag/developer-guide/quick-launch/damm-v1-launch-pool.md': [
    '# DAMM v1 Launch Pool',
    '',
    '| Field | Type | Description | Example |',
    '| --- | --- | --- | --- |',
    '| quoteMint | string | Quote mint is required for pool creation. | So11111111111111111111111111111111111111112 |',
    '| baseAmount | number | Base token amount to seed. | 100 |',
    '| tradeFeeNumerator | integer | Pool fee in basis points. | 2500 |',
    '| activationType | integer | Activation type. | 1 |',
  ].join('\n'),
  'https://docs.meteora.ag/developer-guide/quick-launch/damm-v2-launch-pool.md': [
    '# DAMM v2 Launch Pool',
    '',
    '| Field | Type | Description | Example |',
    '| --- | --- | --- | --- |',
    '| quoteMint | string | Quote mint is required for pool creation. | So11111111111111111111111111111111111111112 |',
    '| creator | string | Creator address. | YOUR_CREATOR_ADDRESS |',
    '| baseAmount | integer | Base token amount to seed. | 100000000 |',
    '| initPrice | number | Initial price (in terms of quote/base price). | 0.001 |',
    '| useDynamicFee | boolean | Whether dynamic fee is enabled. | true |',
  ].join('\n'),
  'https://docs.meteora.ag/developer-guide/quick-launch/dbc-token-launch-pool.md': [
    '# DBC Token Launch Pool',
    '',
    '| Field | Type | Description | Example |',
    '| --- | --- | --- | --- |',
    '| quoteMint | string | Quote mint is required for the pool. | So11111111111111111111111111111111111111112 |',
    '| buildCurveMode | integer | 0 = buildCurve, 1 = buildCurveWithMarketCap. | 0 |',
    '| percentageSupplyOnMigration | integer | Percentage of total token supply to migrate. | 20 |',
    '| migrationQuoteThreshold | integer | Migration quote threshold needed to migrate the token pool. | 10 |',
    '| totalTokenSupply | integer | Total token supply. | 1000000000 |',
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

  const [{ createApp }, { listDocs }, { getDoc }, { searchDocs }, { getActionSchema }, { resolveParam }] = await Promise.all([
    import('../src/index.js'),
    import('../src/tools/list-docs.js'),
    import('../src/tools/get-doc.js'),
    import('../src/tools/search-docs.js'),
    import('../src/tools/action-schema.js'),
    import('../src/tools/resolve-param.js'),
  ]);

  return { createApp, listDocs, getDoc, searchDocs, getActionSchema, resolveParam, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const listSchema = z.object({
  pages: z.array(z.object({ title: z.string(), url: z.string().url() })),
});

const docSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  content: z.string(),
});

const searchSchema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string().url(), excerpt: z.string() })),
});

const actionSchema = z.object({
  action: z.enum(['launch-dlmm', 'launch-dbc', 'launch-damm-v1', 'launch-damm-v2']),
  sourceUrl: z.string().url(),
  configFields: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
    required: z.boolean(),
  })),
  schema: z.object({ type: z.literal('object') }),
  example: z.record(z.string(), z.unknown()),
});

const resolveSchema = z.object({
  action: z.enum(['launch-dlmm', 'launch-dbc', 'launch-damm-v1', 'launch-damm-v2']),
  param: z.string(),
  explanation: z.string(),
  sourceUrl: z.string().url(),
  validValues: z.array(z.string()).optional(),
});

describe('docs-driven MCP tools', () => {
  it('lists the docs index and filters by keyword', async () => {
    const { listDocs } = await loadTools();

    const result = await listDocs('launch pool');
    const parsed = listSchema.parse(result);

    expect(parsed.pages).toHaveLength(4);
    expect(parsed.pages.map((page) => page.title)).toContain('DLMM Launch Pool');
  });

  it('fetches a doc page as markdown and normalizes the .md url', async () => {
    const { getDoc } = await loadTools();

    const result = await getDoc('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool');
    const parsed = docSchema.parse(result);

    expect(parsed.url).toBe('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md');
    expect(parsed.title).toBe('DLMM Launch Pool');
    expect(parsed.content).toContain('Price increment/decrement percentage');
  });

  it('returns title matches on a cold cache', async () => {
    const { searchDocs } = await loadTools();

    const result = searchSchema.parse(await searchDocs('DBC'));
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe('DBC Token Launch Pool');
    expect(result.results[0]?.excerpt).toBe('DBC Token Launch Pool');
  });

  it('searches cached pages for content after fetch', async () => {
    const { getDoc, searchDocs } = await loadTools();

    await getDoc('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool');
    const after = searchSchema.parse(await searchDocs('binStep'));

    expect(after.results).toHaveLength(1);
    expect(after.results[0]?.title).toBe('DLMM Launch Pool');
    expect(after.results[0]?.excerpt).toContain('binStep');
  });

  it('derives config fields from the quick-launch docs tables', async () => {
    const { getActionSchema } = await loadTools();

    const result = await getActionSchema('launch-dlmm');
    const parsed = actionSchema.parse(result);

    expect(parsed.sourceUrl).toBe('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md');
    expect(parsed.configFields.find((field) => field.name === 'rpcUrl')?.required).toBe(true);
    expect(parsed.configFields.find((field) => field.name === 'binStep')?.type).toBe('integer');
    expect(parsed.configFields.find((field) => field.name === 'binStep')?.description).toContain('price step');
    expect(parsed.schema.type).toBe('object');
    expect(parsed.example).toBeTypeOf('object');
  });

  it('explains launch parameters using docs-backed references', async () => {
    const { resolveParam } = await loadTools();

    const result = await resolveSchema.parse(await resolveParam('launch-dlmm', 'binStep'));

    expect(result.explanation).toContain('price granularity');
    expect(result.sourceUrl).toBe('https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md');
  });
});
