# Meteora MCP Server + Metsumi Intent Harness

A two-part TypeScript workspace for interacting with Meteora in a way that is both docs-driven and execution-capable:

1. `mcp-server/` — a read-only Meteora documentation server that exposes Meteora docs, quick-launch schemas, and parameter references as tools.
2. `harness/` — an execution harness that turns a natural-language goal into an on-chain Meteora action by planning, launching the Meteora Invent CLI, confirming the transaction on Solana, and retrying when recovery is possible.

The bridge between them is the `meteora_execute_goal` tool. A client calls the MCP server with a goal like:

> Launch a DLMM pool for SOL/USDC with bin step 10, seed 5 SOL on devnet

The server streams stage-by-stage progress from the harness and returns final on-chain proof when the action completes.

## Why this repo exists

Meteora has excellent docs, but no MCP server. That creates a gap for agents: they can read the docs, but they still need help resolving the right config fields and action-specific parameters.

This repository closes that gap in two layers:

- The MCP server fetches and serves Meteora docs directly from `docs.meteora.ag`.
- The harness uses those docs to resolve action schemas and parameter guidance, then executes the actual Meteora Invent CLI workflow against Solana.

In other words:

- docs layer = explain and structure the protocol
- execution layer = perform the on-chain work

## Repository layout

```text
.
├── AGENTS.md
├── PLAN.md
├── README.md
├── .env.example
├── package.json
├── scripts/
│   └── demo.ts
├── mcp-server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── stdio.ts
│   │   ├── docs.ts
│   │   └── tools/
│   └── tests/
├── harness/
│   ├── src/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── lib/
│   │   └── stages/
│   └── tests/
└── meteora-invent/   # git submodule, do not modify
```

## What each package does

### `mcp-server/`

The MCP server exposes the Meteora docs and the bridge into the harness.

It provides these tools:

- `meteora_list_docs` — returns the Meteora documentation index from `llms.txt`
- `meteora_get_doc` — fetches a single docs page as markdown
- `meteora_search_docs` — searches the docs index and cached page content
- `meteora_get_action_schema` — derives config fields for a quick-launch action
- `meteora_resolve_param` — explains a specific launch parameter using docs-backed reference text
- `meteora_execute_goal` — runs the harness end to end and streams results

The HTTP server exposes the tool surface at:

- `GET /tools`
- `POST /tools/:name`

There is also a stdio transport for local MCP clients in `mcp-server/src/stdio.ts`.

### `harness/`

The harness is a library, not a server. It exports an async generator orchestrator that yields stage events while it works:

1. Parse
2. Plan
3. Execute
4. Verify
5. Recover
6. Done

The harness owns the wallet and the on-chain side effects. It resolves the right Meteora config from docs, writes a temporary Metsumi config file, shells out to Meteora Invent, then polls Solana RPC for confirmation.

## Architecture

```text
Codex or other MCP client
  │ calls meteora_execute_goal({ goal })
  ▼
MCP server
  │ reads Meteora docs and invokes the harness
  ▼
Harness
  │ Parse → Plan → Execute → Verify → Recover → Done
  │ shells out to meteora-invent
  ▼
Meteora Invent CLI
  │ broadcasts Solana transactions
  ▼
Solana
```

## Prerequisites

- Node.js 18 or newer
- `corepack`
- `pnpm`
- A Solana wallet with funds for the target network
- Internet access to:
  - `https://docs.meteora.ag`
  - your Solana RPC endpoint
- `OPENAI_API_KEY` for the parse and recovery stages

## Environment variables

Copy `.env.example` to `.env` and fill in the values you need.

| Variable | Purpose |
| --- | --- |
| `PRIVATE_KEY` | Solana wallet private key. Can be a base58 key or a JSON keypair string. |
| `KEYPAIR_FILE` | Optional fallback path to a local keypair file. Used when `PRIVATE_KEY` is not set. |
| `RPC_URL` | Solana RPC endpoint. Defaults to devnet in the example file. |
| `NETWORK` | Intended Solana cluster setting (`devnet` or `mainnet-beta`). |
| `MCP_PORT` | HTTP port for the MCP server. |
| `MAX_RETRIES` | Harness retry cap for recoverable failures. |
| `OPENAI_API_KEY` | OpenAI API key used by the parse and recovery stages. |
| `MCP_BASE_URL` | Optional override for the harness-to-server HTTP base URL. |

Notes:

- The harness reads the wallet from `PRIVATE_KEY`, or from `KEYPAIR_FILE` if `PRIVATE_KEY` is missing.
- The MCP server defaults to port `3000`.
- The harness defaults to the Meteora docs-driven workflow and devnet-oriented settings unless the parsed goal specifies otherwise.

## Setup

```bash
git clone <repo-url>
cd Ralphthon-MetTools
git submodule update --init --recursive
corepack pnpm install
cp .env.example .env
```

If you already have a local keypair file, set:

```bash
KEYPAIR_FILE=./keypair.json
```

and the demo/harness can use that instead of embedding a base58 secret in `PRIVATE_KEY`.

## Running the MCP server

### HTTP server

Start the HTTP server with:

```bash
corepack pnpm --filter mcp-server start
```

By default it listens on `http://localhost:3000`.

Inspect the tool manifest:

```bash
curl http://localhost:3000/tools
```

Call a tool:

```bash
curl -X POST http://localhost:3000/tools/meteora_list_docs \
  -H 'Content-Type: application/json' \
  -d '{"filter":"launch"}'
```

### stdio server

For local MCP clients that expect stdio transport:

```bash
corepack pnpm --filter mcp-server stdio
```

## Using the tools

### `meteora_list_docs`

Returns the full Meteora documentation index from `llms.txt`.

Example:

```bash
curl -X POST http://localhost:3000/tools/meteora_list_docs \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### `meteora_get_doc`

Fetches one docs page as markdown.

Example:

```bash
curl -X POST http://localhost:3000/tools/meteora_get_doc \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://docs.meteora.ag/developer-guide/home"}'
```

### `meteora_search_docs`

Searches cached doc pages and the title index.

Example:

```bash
curl -X POST http://localhost:3000/tools/meteora_search_docs \
  -H 'Content-Type: application/json' \
  -d '{"query":"bin step"}'
```

### `meteora_get_action_schema`

Returns config fields and a schema for one of the supported quick-launch actions:

- `launch-dlmm`
- `launch-dbc`
- `launch-damm-v1`
- `launch-damm-v2`

Example:

```bash
curl -X POST http://localhost:3000/tools/meteora_get_action_schema \
  -H 'Content-Type: application/json' \
  -d '{"action":"launch-dlmm"}'
```

### `meteora_resolve_param`

Returns a docs-backed explanation for a single config parameter.

Example:

```bash
curl -X POST http://localhost:3000/tools/meteora_resolve_param \
  -H 'Content-Type: application/json' \
  -d '{"action":"launch-dlmm","param":"binStep"}'
```

### `meteora_execute_goal`

Triggers the full harness loop and streams SSE-style stage events.

Example:

```bash
curl -N -X POST http://localhost:3000/tools/meteora_execute_goal \
  -H 'Content-Type: application/json' \
  -d '{"goal":"Launch a DLMM pool for SOL/USDC with bin step 10, seed 5 SOL on devnet"}'
```

This tool has side effects. It can write configs, invoke Meteora Invent, and submit Solana transactions.

## Harness behavior

The harness is built around a staged execution loop.

### Parse

- Calls OpenAI `gpt-4o-mini`
- Extracts the supported Meteora action
- Captures parameters, the target network, and ambiguities
- Returns a structured intent or a parse failure

### Plan

- Fetches the action schema from the MCP server
- Resolves any ambiguous parameters using docs-backed guidance
- Asks the model for sensible defaults when needed
- Normalizes and validates the merged config against the schema

### Execute

- Writes a temporary JSONC config file for Meteora Invent
- Runs the relevant `meteora-invent` CLI command with `execa`
- Extracts the transaction hash from CLI output
- Classifies common failure modes into retryable and non-retryable errors
- Cleans up temporary files in all cases

### Verify

- Connects to Solana RPC
- Waits for signature confirmation
- Fetches the parsed transaction
- Extracts proof fields such as `slot`, `confirmedAt`, and `poolAddress` when available

### Recover

- Classifies the failure
- Aborts on terminal issues like insufficient SOL
- Suggests a config patch on retryable config or RPC problems
- Uses the model again when it can propose a better config value

## Running the demo

The repository includes a demo script that spins up the MCP app in-process and exercises the end-to-end flow.

```bash
corepack pnpm demo
```

By default the script uses a DLMM launch goal on devnet. You can override the goal with `DEMO_GOAL`.

If you are using a local keypair file, set `KEYPAIR_FILE` before running the demo.

## Tests

Run the full workspace test suite:

```bash
corepack pnpm test
```

Run a package-specific test suite:

```bash
corepack pnpm --filter mcp-server test
corepack pnpm --filter harness test
```

## Build

Build both packages:

```bash
corepack pnpm build
```

Or build a single package:

```bash
corepack pnpm --filter mcp-server build
corepack pnpm --filter harness build
```

## Development notes

- Do not modify anything inside `meteora-invent/`; it is a git submodule.
- The MCP server caches docs content in memory after first fetch.
- Docs are sourced directly from `docs.meteora.ag`, so the project stays aligned with the live docs.
- The harness is intended to be imported by the MCP server rather than exposed as a standalone API server.
- The SSE response from `meteora_execute_goal` is meant for machine consumption; the final payload contains the on-chain proof or a structured failure result.

## Troubleshooting

### `OPENAI_API_KEY` missing

The parse and recovery stages require an OpenAI API key. Set it in `.env` or your shell before running the harness.

### `PRIVATE_KEY` missing

Set `PRIVATE_KEY` or `KEYPAIR_FILE`. The demo script will refuse to run without a wallet.

### RPC errors or slow confirmations

Check `RPC_URL`, your network connection, and the amount of SOL in the wallet. On devnet, RPC instability can cause retries.

### Docs fetch failures

The MCP server fetches Meteora docs at startup and on demand. If the docs site is unreachable, doc tools will fail until the network is restored.

### `meteora-invent` missing

Initialize the submodule:

```bash
git submodule update --init --recursive
```

### Temporary config files

The harness creates temporary files under `meteora-invent/studio/config/` and deletes them when execution finishes. If a run is interrupted, you may need to remove a leftover `harness_tmp_*.jsonc` file manually.

## Status

This repo currently contains the complete workspace scaffold, docs server, harness, and demo wiring.

See `PLAN.md` for the milestone history and project progress.
