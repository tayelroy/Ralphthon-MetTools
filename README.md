# Meteora MCP Server + Metsumi Harness

This repository delivers two pieces:

1. A read-only Meteora MCP server that exposes docs, schemas, and SDK references.
2. A Metsumi harness that turns a natural-language goal into an on-chain Meteora action.

## Prerequisites

- Node.js 18+
- pnpm
- A funded Solana devnet wallet
- `OPENAI_API_KEY` for parsing and recovery

## Setup

```bash
git clone <repo>
cd <repo>
git submodule update --init --recursive
pnpm install
cp .env.example .env
```

## Start the server

```bash
pnpm --filter mcp-server build
pnpm --filter mcp-server start
```

## Run the demo

```bash
KEYPAIR_FILE=./keypair.json OPENAI_API_KEY=... pnpm demo
```

See `docs/hackathon-demo.md` for the full runbook.

## Run tests

```bash
pnpm -r test
```

## Architecture

```text
Codex
  │ calls meteora_execute_goal
  ▼
MCP server (docs + SSE bridge)
  │ loads docs and runs harness
  ▼
Harness (parse → plan → execute → verify → recover)
  │ shells out to meteora-invent
  ▼
Meteora Invent CLI
  │ broadcasts Solana tx
  ▼
Solana
```
