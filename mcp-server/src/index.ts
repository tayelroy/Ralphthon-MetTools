import express, { type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { preloadDocs } from './docs.js';
import { listDocs } from './tools/list-docs.js';
import { getActionSchema, type ActionName } from './tools/action-schema.js';
import { resolveParam } from './tools/resolve-param.js';
import { getDoc } from './tools/get-doc.js';
import { searchDocs } from './tools/search-docs.js';
import { createExecuteGoalHandler, type RunGoalFn } from './tools/execute-goal.js';

dotenv.config();

export type ServerDeps = { runGoal?: RunGoalFn };

const manifest = [
  {
    name: 'meteora_list_docs',
    description: 'Returns the Meteora documentation index from llms.txt.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'meteora_get_doc',
    description: 'Fetches a single Meteora doc page in markdown form.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'meteora_search_docs',
    description: 'Searches the Meteora docs index and any cached doc pages for a keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'meteora_get_action_schema',
    description: 'Derives quick-launch config fields from the Meteora docs.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['launch-dlmm', 'launch-dbc', 'launch-damm-v1', 'launch-damm-v2'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'meteora_resolve_param',
    description: 'Explains a Meteora launch parameter using docs-backed reference text.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['launch-dlmm', 'launch-dbc', 'launch-damm-v1', 'launch-damm-v2'] },
        param: { type: 'string' },
      },
      required: ['action', 'param'],
      additionalProperties: false,
    },
  },
  {
    name: 'meteora_execute_goal',
    description: 'Executes a natural-language Meteora DeFi goal end-to-end. Launches pools, swaps tokens, or other on-chain actions autonomously. Streams stage-by-stage progress and returns on-chain proof of completion. Use this tool when the user wants to perform a Meteora action.',
    inputSchema: {
      type: 'object',
      properties: { goal: { type: 'string' } },
      required: ['goal'],
      additionalProperties: false,
    },
  },
] as const;

/** Creates the Express app for the MCP server. */
export async function createApp(deps: ServerDeps = {}) {
  await preloadDocs();

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const executeGoal = createExecuteGoalHandler(deps.runGoal);

  app.get('/tools', async (_req, res) => {
    res.json({ tools: manifest });
  });

  app.post('/tools/:name', async (req: Request, res: Response) => {
    const { name } = req.params;
    try {
      switch (name) {
        case 'meteora_list_docs':
          return void res.json(await listDocs(typeof req.body?.filter === 'string' ? req.body.filter : undefined));
        case 'meteora_get_doc':
          return void res.json(await getDoc(String(req.body?.url ?? '')));
        case 'meteora_search_docs':
          return void res.json(await searchDocs(String(req.body?.query ?? '')));
        case 'meteora_get_action_schema':
          return void res.json(await getActionSchema(String(req.body?.action) as ActionName));
        case 'meteora_resolve_param':
          return void res.json(await resolveParam(String(req.body?.action) as ActionName, String(req.body?.param ?? '')));
        case 'meteora_execute_goal':
          return void (await executeGoal(String(req.body?.goal ?? ''), res));
        default:
          res.status(404).json({ error: `unknown tool: ${name}` });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'unknown error' });
    }
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MCP_PORT ?? '3000');
  void (async () => {
    const app = await createApp();
    app.listen(port, () => {
      console.error(`MCP server listening on ${port}`);
    });
  })();
}
