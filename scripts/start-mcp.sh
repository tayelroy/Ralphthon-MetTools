#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
MCP_PORT=3000 corepack pnpm --filter mcp-server start
