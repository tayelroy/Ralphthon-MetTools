import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const llmsText = `# Meteora Documentation

## Docs

- [Overview](https://docs.meteora.ag/developer-guide/home.md)
- [DLMM Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md)
- [DAMM v1 Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/damm-v1-launch-pool.md)
- [DAMM v2 Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/damm-v2-launch-pool.md)
- [DBC Token Launch Pool](https://docs.meteora.ag/developer-guide/quick-launch/dbc-token-launch-pool.md)
`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('MCP server manifest', () => {
  it('exposes the docs-driven tools on GET /tools', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(url === 'https://docs.meteora.ag/llms.txt' ? llmsText : '# Overview', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }));

    const { createApp } = await import('../src/index.js');
    const app = await createApp();
    const server = createServer(app as never);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to start server');

    const response = await originalFetch(`http://127.0.0.1:${address.port}/tools`);
    expect(response.ok).toBe(true);
    const body = await response.json() as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };

    expect(body.tools).toHaveLength(5);
    expect(body.tools.map((tool) => tool.name)).toEqual([
      'meteora_list_docs',
      'meteora_get_doc',
      'meteora_search_docs',
      'meteora_get_action_schema',
      'meteora_execute_goal',
    ]);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
