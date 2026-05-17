import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { preloadDocs } from './docs.js';
import { listDocs } from './tools/list-docs.js';
import { getActionSchema, type ActionName } from './tools/action-schema.js';
import { resolveParam } from './tools/resolve-param.js';
import { getDoc } from './tools/get-doc.js';
import { searchDocs } from './tools/search-docs.js';
import { createExecuteGoalHandler } from './tools/execute-goal.js';

dotenv.config();

const ACTION_ENUM = ['launch-dlmm', 'launch-dbc', 'launch-damm-v1', 'launch-damm-v2'] as const;

async function main(): Promise<void> {
  await preloadDocs();

  const server = new McpServer({ name: 'meteora', version: '1.0.0' });
  const executeGoal = createExecuteGoalHandler();

  server.tool(
    'meteora_list_docs',
    'Returns the Meteora documentation index from llms.txt.',
    { filter: z.string().optional().describe('Keyword to filter results') },
    async ({ filter }) => {
      const result = await listDocs(filter);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'meteora_get_doc',
    'Fetches a single Meteora doc page in markdown form.',
    { url: z.string().describe('Full URL of the doc page') },
    async ({ url }) => {
      const result = await getDoc(url);
      return { content: [{ type: 'text', text: result.content }] };
    },
  );

  server.tool(
    'meteora_search_docs',
    'Searches the Meteora docs index and any cached doc pages for a keyword.',
    { query: z.string().describe('Search keyword') },
    async ({ query }) => {
      const result = await searchDocs(query);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'meteora_get_action_schema',
    'Derives quick-launch config fields from the Meteora docs.',
    { action: z.enum(ACTION_ENUM).describe('Metsumi action name') },
    async ({ action }) => {
      const result = await getActionSchema(action as ActionName);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'meteora_resolve_param',
    'Explains a Meteora launch parameter using docs-backed reference text.',
    {
      action: z.enum(ACTION_ENUM).describe('Metsumi action name'),
      param: z.string().describe('Parameter name to explain'),
    },
    async ({ action, param }) => {
      const result = await resolveParam(action as ActionName, param);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'meteora_execute_goal',
    'Executes a natural-language Meteora DeFi goal end-to-end. Launches pools, swaps tokens, or other on-chain actions autonomously. Streams stage-by-stage progress and returns on-chain proof of completion. Use this tool when the user wants to perform a Meteora action.',
    { goal: z.string().describe('Natural-language goal, e.g. "Launch a DLMM pool for SOL/USDC on devnet"') },
    async ({ goal }) => {
      const events: string[] = [];

      // Collect all streamed events into a text response for stdio transport.
      const fakeRes = {
        setHeader: () => {},
        flushHeaders: () => {},
        write: (chunk: string) => { events.push(chunk); },
        end: () => {},
      } as unknown as import('express').Response;

      await executeGoal(goal, fakeRes);

      return { content: [{ type: 'text', text: events.join('') }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`[meteora-mcp] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
