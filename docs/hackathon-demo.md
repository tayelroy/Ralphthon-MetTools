# Hackathon demo runbook

Goal: show that one natural-language request can drive a full Meteora launch flow.

## What this proves

- The MCP server can read Meteora docs and return config/schema data.
- The harness can parse a goal, plan parameters, execute a launch, and verify the result.
- A funded keypair can be supplied from `./keypair.json` without hand-editing the wallet.

## Preflight

Make sure these files exist:

- `./keypair.json`
- `./.env` with `OPENAI_API_KEY`, `RPC_URL`, and `NETWORK=devnet`

If you want to use the keypair file directly, the demo script will read `./keypair.json` and set `PRIVATE_KEY` automatically when `PRIVATE_KEY` is not already present.

## One-command demo

```bash
KEYPAIR_FILE=./keypair.json OPENAI_API_KEY=... pnpm demo
```

What it does:

1. Loads the wallet from `PRIVATE_KEY` or `KEYPAIR_FILE`.
2. Starts the MCP server locally.
3. Checks the docs tool surface with `meteora_list_docs`.
4. Verifies the DLMM action schema with `meteora_get_action_schema`.
5. Runs `meteora_execute_goal` with the demo goal.
6. Streams `parse`, `plan`, `execute`, `verify`, and `done` events.

## Recommended demo script

Use this exact sentence for the live run:

> Launch a DLMM pool for SOL/USDC with bin step 10, seed 5 SOL one-sided on devnet.

## What to point at while it runs

- The docs-derived tool schema: proof the agent is not guessing.
- The stage stream: proof that the human is out of the loop.
- The final proof object: tx hash, slot, and pool address.

## Fast troubleshooting

- If the demo exits immediately with `missing PRIVATE_KEY or KEYPAIR_FILE`, export `KEYPAIR_FILE=./keypair.json` or set `PRIVATE_KEY` directly.
- If parsing fails, confirm `OPENAI_API_KEY` is present.
- If execution fails with RPC errors, confirm `RPC_URL` is reachable and the wallet has devnet SOL.
- If the harness says insufficient SOL, refill the wallet and rerun.
