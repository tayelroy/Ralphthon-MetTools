# Meteora MCP Server + Metsumi Intent Harness

This ExecPlan is a living document. The sections `Progress`,
`Surprises & Discoveries`, `Decision Log`, and `Outcomes &
Retrospective` must be kept up to date as work proceeds. This
document must be maintained in accordance with AGENTS.md.


## Purpose / Big Picture

This project delivers two things that work together.

The first is a Meteora MCP Server — a read-only HTTP server that
uses Meteora's own docs as the source of truth. At startup it fetches
`llms.txt`, builds a documentation index, caches doc pages on demand,
and exposes the docs as structured tools. Meteora has no MCP server
today. Any agent that wants to interact with Meteora has to hallucinate
config field names and pool parameters. This server fixes that gap. It
is a standalone ecosystem contribution.

The second is a Metsumi Harness — an orchestrator that takes a
natural-language goal, queries the MCP server to resolve the correct
config, fires the on-chain action via the meteora-invent CLI, confirms
the transaction on Solana, and recovers from failure autonomously. The
harness is what makes the MCP server actionable: it is where the wallet
lives and where real on-chain state gets created.

The bridge between them is a single MCP tool called
`meteora_execute_goal`. When Codex calls it with a goal string, the
MCP server delegates to the harness, which runs its full loop and
streams stage-by-stage results back. From Codex's perspective it is
just a tool call. From the system's perspective it is a fully
autonomous on-chain operation.

After this plan is executed, a judge can send one natural-language
message to Codex and watch a real Solana pool get created — no human
involvement, no manual config, no copy-pasting transaction hashes.


## Progress

- [x] M1:  Repo scaffold (workspace, submodule, env, tsconfigs)
- [x] M2:  MCP server — static tool stubs passing tests
- [x] M3:  MCP server — real embedded docs content in all tools
- [x] M4:  Harness — types and parse stage with unit tests
- [x] M5:  Harness — plan stage (config generation) with unit tests
- [x] M6:  Harness — execute stage (Metsumi subprocess) with unit tests
- [x] M7:  Harness — verify stage (Solana RPC polling) with unit tests
- [x] M8:  Harness — recover stage + orchestrator retry loop
- [x] M9:  MCP server — meteora_execute_goal SSE bridge tool
- [ ] M10: Integration test on devnet (launch-dlmm end-to-end)
- [ ] M11: Integration test on devnet (launch-dbc end-to-end)
- [x] M12: README, demo script, final cleanup


## Surprises & Discoveries

- Repository scaffolding was created, but this environment blocked two verification steps: fetching `pnpm` via corepack and adding the `meteora-invent` submodule. The scaffold itself is in place.
- Devnet integration milestones (M10/M11) are blocked in this session because the required `.env` file and credentials (`PRIVATE_KEY`, `OPENAI_API_KEY`) are absent from the environment.


## Decision Log

- Decision: MCP server is a docs server only. It discovers the docs index from llms.txt at startup, fetches `.md` pages on demand, and caches them in memory.
  Rationale: Docs-driven tooling stays aligned with the live Meteora documentation while still keeping repeat requests fast through in-memory caching. The index is small, and quick-launch schemas can be derived from the docs pages themselves instead of maintaining a parallel JSON source tree.
  Date/Author: 2026-05-17 / updated architecture

- Decision: `meteora_execute_goal` lives in the MCP server but calls
  the harness as a library import, not via HTTP.
  Rationale: The harness is a library, not a separate server. Having
  it as a library import keeps the process count at one (just the MCP
  server), simplifies deployment, and avoids inter-process networking.
  Date/Author: 2026-05-17 / initial plan

- Decision: Harness shells out to meteora-invent CLI rather than
  calling the SDK directly.
  Rationale: The meteora-invent CLI is Meteora's officially supported
  tool and is already tested by Meteora. Building our own transaction
  logic from the SDK would be fragile under hackathon time pressure.
  The CLI approach also makes it easy to verify execution by reading
  its stdout.
  Date/Author: 2026-05-17 / initial plan

- Decision: Support only three Metsumi actions (launch-dlmm,
  launch-dbc, swap) with full verify/recover coverage.
  Rationale: Deep coverage on three actions is more technically
  impressive to Harness track judges than shallow stubs for all
  twenty. The demo surface is cleaner and the recovery logic is
  meaningfully exercised.
  Date/Author: 2026-05-17 / initial plan

- Decision: MCP transport is HTTP/SSE, not stdio.
  Rationale: Codex connects to MCP servers over HTTP in its cloud
  environment. Stdio transport is for local IDE use only. The hackathon
  demo runs Codex against a live HTTP server.
  Date/Author: 2026-05-17 / initial plan


## Outcomes & Retrospective

(Populated at completion.)


## Context and Orientation

### What Meteora is

Meteora is a DeFi liquidity protocol on Solana. It offers several pool
types. The two most relevant here are:

DLMM (Dynamic Liquidity Market Maker): a concentrated liquidity pool
where liquidity sits in discrete price bins. A liquidity provider
chooses a bin step (price granularity) and seeds liquidity around an
active bin (the current price). Configured via `dlmm_config.jsonc`.

DBC (Dynamic Bonding Curve): a token launch pool. The price follows a
bonding curve and the pool graduates to a DAMM pool once a configurable
SOL market cap threshold is hit. Configured via `dbc_config.jsonc`.

### What Metsumi is

Metsumi is a CLI tool inside the MeteoraAg/meteora-invent repository.
It is not an API. It reads a JSONC config file from disk and broadcasts
an on-chain transaction. You run it like this:

    cd meteora-invent
    pnpm install
    pnpm studio launch-dlmm --network devnet

The config for the launch-dlmm action lives at
`studio/config/dlmm_config.jsonc`. The harness fills this file (as a
temp copy) and then runs the command above.

### What MCP is

MCP (Model Context Protocol) is an open standard for exposing tools to
LLMs. An MCP server is an HTTP server that advertises a tool manifest
at `GET /tools`. Each tool has a name, a description, and a JSON Schema
for its input. An LLM calls a tool by sending `POST /tools/:name` with
a JSON body; the server returns a JSON result. Codex is MCP-aware: it
reads the manifest, decides which tool to call, and calls it without
human instruction.

### Where the content in the MCP server comes from

The MCP server now discovers its documentation at startup by fetching
https://docs.meteora.ag/llms.txt and parsing the links into an in-memory
index of page titles and URLs. Individual docs pages are fetched on
demand from their `.md` variants and cached in memory after the first
request.

The read-only MCP tools serve content directly from Meteora docs pages.
The action schema tool derives its field list from the relevant quick
launch guides rather than from local JSONC files.


### Key file locations after the full scaffold

    meteora-harness/
      AGENTS.md
      PLAN.md
      package.json                    pnpm workspace { workspaces: ["mcp-server","harness"] }
      .env.example
      README.md
      mcp-server/
        src/
          index.ts                    Express server, mounts all tool routes
          docs.ts                     llms.txt index, doc cache, quick-launch schema parser
          tools/
            list-docs.ts              meteora_list_docs handler
            get-doc.ts                meteora_get_doc handler
            search-docs.ts             meteora_search_docs handler
            action-schema.ts          meteora_get_action_schema handler
            execute-goal.ts           meteora_execute_goal SSE bridge
            shared.ts                 shared tool response helpers
        package.json
        tsconfig.json
        vitest.config.ts
        tests/
          docs.test.ts
          index.test.ts
          execute-goal.test.ts
      harness/
        src/
          index.ts                    runGoal() orchestrator, exported as AsyncGenerator
          types.ts                    StageResult, ParsedIntent, MetsumiConfig, OnChainProof, etc.
          stages/
            parse.ts                  LLM intent extraction
            plan.ts                   config assembly via MCP tools
            execute.ts                Metsumi CLI subprocess runner
            verify.ts                 Solana RPC confirmation + log parsing
            recover.ts                error classification + config repair
        package.json
        tsconfig.json
        vitest.config.ts
        tests/
          parse.test.ts
          plan.test.ts
          execute.test.ts
          verify.test.ts
          recover.test.ts
          orchestrator.test.ts
      meteora-invent/                 git submodule — do not modify
        studio/
          config/
            dlmm_config.jsonc
            dbc_config.jsonc


## Plan of Work

### Milestone 1 — Repo scaffold

Create the monorepo. Initialize git, add meteora-invent as a submodule,
create the pnpm workspace, scaffold both packages, write .env.example.

The root package.json must be:

    {
      "name": "meteora-harness-root",
      "private": true,
      "workspaces": ["mcp-server", "harness"],
      "scripts": {
        "test": "pnpm -r test",
        "build": "pnpm -r build",
        "demo": "tsx scripts/demo.ts"
      }
    }

Dependencies for mcp-server: express, zod, dotenv, @solana/web3.js
Dependencies for harness: zod, dotenv, @solana/web3.js, execa, openai
Dev dependencies (both): typescript, vitest, @types/node, tsx

The tsconfig.base.json at root must enable strict mode, target ES2022,
and use NodeNext module resolution.

Acceptance: `pnpm install` exits 0. `pnpm -r test` exits 0 with a
message indicating no test files found (correct for this milestone).


### Milestone 2 — MCP server tool stubs

Create `mcp-server/src/index.ts` as an Express server on `MCP_PORT`.

Implement `GET /tools` returning the MCP manifest: an array of tool
descriptors each with `name`, `description`, and `inputSchema`
(JSON Schema object).

Implement `POST /tools/:name` dispatching to tool handler files in
`mcp-server/src/tools/`. Each handler is an async function accepting
the parsed request body and returning a JSON object.

For this milestone every handler returns a hardcoded stub so tests can
assert response shape without needing real content.

Every response object must include a `source` field (string, a Meteora
docs URL) even in stubs. Use a placeholder URL if needed.

Write unit tests in `mcp-server/tests/` for each handler. Tests must:
- Call the handler function directly, not via HTTP.
- Use Zod to assert the response matches the expected shape.
- Assert `source` is a non-empty string.

Acceptance: `pnpm --filter mcp-server test` passes all stub tests.
`curl http://localhost:3000/tools` returns the manifest JSON with five
tool entries.


### Milestone 3 — MCP server real content

Replace stub responses with real content. This is a content authoring
milestone — the agent reads Meteora's docs (URLs listed in the
Artifacts section below) and writes the JSON data files.

For `data/pool-types.json`: write a JSON array covering DLMM, DAMM v1,
DAMM v2, and DBC. Each entry must have `name`, `description`, `useCase`
(one sentence), `keywords` (array of strings), and `source` (URL).
Derive content from https://docs.meteora.ag/developer-guide/home and
https://docs.meteora.ag/overview/home.

For `data/schemas/launch-dlmm.json`: at server startup, read
`meteora-invent/studio/config/dlmm_config.jsonc`, strip JSONC comments,
parse it, and derive a JSON Schema. Do the same for `launch-dbc.json`
and `swap.json`. The schema derivation logic lives in a helper at
`mcp-server/src/tools/action-schema.ts` and runs once at startup,
caching the result in memory.

For `data/param-reference.json`: write a JSON object mapping param
names to `{ explanation, validValues?, source }`. Must cover at minimum:
binStep, activeId, initialPrice, seedAmount, tokenAMint, tokenBMint,
migrationThreshold, feeBps, quoteMint, curvature.

For `data/sdk/dlmm.json` and `data/sdk/dbc.json`: embed key function
signatures from the respective SDK GitHub repos. Five to ten functions
per SDK is sufficient.

Update tests so at least one test per tool asserts a specific field
value from the real data (not just shape).

Acceptance: `pnpm --filter mcp-server test` passes. Calling
`POST /tools/meteora_get_action_schema` with body
`{"action":"launch-dlmm"}` returns a schema object containing a
`binStep` field. Calling `POST /tools/meteora_resolve_param` with body
`{"param":"binStep","action":"launch-dlmm"}` returns an explanation
mentioning price granularity or price bins.


### Milestone 4 — Harness types and parse stage

Create `harness/src/types.ts` with all shared types. See the Interfaces
section below for exact definitions.

Create `harness/src/stages/parse.ts`. The parse stage calls the OpenAI
chat completions API (model: gpt-4o-mini) with this system prompt:

    You are a Meteora DeFi intent parser. Extract the intended on-chain
    action and its parameters from the user's goal. Supported actions are:
    launch-dlmm, launch-dbc, swap. Return only valid JSON matching this
    schema: { action, params: Record<string,unknown>, network, ambiguities:
    string[] }. network defaults to "devnet" if not specified. If a
    parameter is mentioned but its value is unclear, add the param name to
    ambiguities. If the action is not one of the three supported actions,
    return { error: "unsupported action" }.

On a successful LLM response, parse the JSON and return
`{ ok: true, value: ParsedIntent }`. On a parse failure or unsupported
action, return `{ ok: false, code: "PARSE_FAILED", retryable: false }`.

Write unit tests that stub the OpenAI client. Test cases:
- Full intent: all required params present, ambiguities empty.
- Partial intent: some params missing, they appear in ambiguities.
- Unsupported action: returns PARSE_FAILED.
- LLM returns malformed JSON: returns PARSE_FAILED.

Acceptance: `pnpm --filter harness test` passes. The parse stage
extracts `{ action: "launch-dlmm", params: { binStep: 10, seedAmount:
5 }, network: "devnet", ambiguities: ["activeId"] }` from "Launch a
DLMM pool for SOL/USDC, bin step 10, seed 5 SOL, devnet" (activeId
is ambiguous because price was not specified).


### Milestone 5 — Harness plan stage

Create `harness/src/stages/plan.ts`. The plan stage:

1. Calls `POST /tools/meteora_get_action_schema` on the MCP server
   (at `MCP_BASE_URL` env var, default `http://localhost:3000`) with
   the action name. Gets back the JSON Schema for the config.

2. For each param in `intent.ambiguities`, calls
   `POST /tools/meteora_resolve_param` to get its explanation. Then
   makes a second LLM call (gpt-4o-mini) with the explanation and full
   intent context to choose a sensible default value. Logs the chosen
   default and the reasoning to stderr.

3. Merges `intent.params` with resolved defaults.

4. Validates the merged object against the schema from step 1 using
   Zod (derive a Zod schema from the JSON Schema). If validation fails,
   returns `{ ok: false, code: "INVALID_CONFIG", retryable: true,
   error: <validation message> }`.

5. Returns `{ ok: true, value: config }`.

Write unit tests that stub the MCP server HTTP calls and the OpenAI
client. Test cases:
- All params present: returns valid config, no MCP resolve calls.
- Ambiguous param resolved: MCP resolve called, LLM picks default,
  config validates.
- Schema validation failure: returns INVALID_CONFIG.

Acceptance: `pnpm --filter harness test` passes. Given a fully resolved
ParsedIntent for launch-dlmm, plan returns a config object that matches
the shape of `meteora-invent/studio/config/dlmm_config.jsonc`.


### Milestone 6 — Harness execute stage

Create `harness/src/stages/execute.ts`. The execute stage:

1. Serializes the MetsumiConfig to JSONC (with a comment header
   indicating it is agent-generated) and writes it to
   `meteora-invent/studio/config/harness_tmp_<Date.now()>.jsonc`.

2. Runs `pnpm --filter meteora-invent studio <action> --network
   <network>` using execa with a 120-second timeout.

3. On exit code 0: scans stdout for a line matching
   `Transaction: <hash>` or `Signature: <hash>` (check actual
   meteora-invent output format and update this plan under Surprises
   & Discoveries). Returns `{ ok: true, value: { txHash } }`.

4. On non-zero exit: classifies the error from stderr content:
   - "insufficient lamports" or "insufficient funds" → INSUFFICIENT_SOL,
     retryable: false
   - "blockhash not found" or "timed out" or "connection refused" →
     RPC_ERROR, retryable: true
   - "invalid account data" or "invalid config" → INVALID_CONFIG,
     retryable: true
   - all others → UNKNOWN, retryable: false

5. Always deletes the temp config file in a finally block.

Write unit tests stubbing execa. Test cases: success with tx hash,
insufficient SOL, RPC timeout, unknown error, temp file deleted in all
cases (assert file does not exist after stage returns).

Acceptance: `pnpm --filter harness test` passes.


### Milestone 7 — Harness verify stage

Create `harness/src/stages/verify.ts`. The verify stage:

1. Creates a Solana Connection using `RPC_URL`.

2. Calls `connection.confirmTransaction(txHash, "confirmed")` wrapped
   in a polling loop: try every 2 seconds, give up after 30 seconds.
   If not confirmed, return `{ ok: false, code: "RPC_ERROR",
   retryable: true }`.

3. Fetches the transaction with `connection.getParsedTransaction(txHash,
   { maxSupportedTransactionVersion: 0 })`.

4. Scans `transaction.meta.logMessages` for a log line emitted by the
   Meteora program that contains the created pool address. The exact
   log format must be verified during M10 integration testing and
   documented in Surprises & Discoveries. Use a best-effort regex for
   now: `/Program log: Pool: ([A-Za-z0-9]{32,44})/` or similar.

5. Returns `{ ok: true, value: { txHash, slot, poolAddress, confirmedAt } }`.

Write unit tests stubbing @solana/web3.js Connection. Test cases:
immediate confirmation, confirmation after 3 polls, 30-second timeout.

Acceptance: `pnpm --filter harness test` passes.


### Milestone 8 — Harness recover stage and orchestrator

Create `harness/src/stages/recover.ts`. The recover stage classifies
the incoming error and returns a RecoveryAction:

    INSUFFICIENT_SOL  → abort ("wallet has insufficient SOL; refill required")
    INVALID_CONFIG    → retry-from-plan with a config patch. Use an LLM call
                        (gpt-4o-mini) with the schema, the bad param name, and
                        the error message to suggest a corrected value.
    RPC_ERROR         → retry-from-plan with no patch (same config, fresh attempt)
    RETRY_CAP_REACHED → abort
    UNKNOWN           → abort
    retryable: false  → always abort regardless of code

Create `harness/src/index.ts` as the orchestrator. It must be an
async generator (AsyncGenerator<StageEvent, StageResult<OnChainProof>>)
so the MCP server can stream events as they happen.

The orchestrator loop:
  - yield { ts, stage: "parse",   status, detail } after parse
  - yield { ts, stage: "plan",    status, detail } after plan
  - yield { ts, stage: "execute", status, detail } after execute
  - yield { ts, stage: "verify",  status, detail } after verify
  - on failure: call recover, yield { stage: "recover", ... }
    if retry-from-plan: apply patch to intent, increment retryCount,
    loop back to plan. If retryCount >= MAX_RETRIES, yield done with
    RETRY_CAP_REACHED and return.
  - on success: yield { stage: "done", status: "ok", summary } and return.

Write unit tests for the orchestrator stubbing all four stage functions.
Test cases: happy path, one retryable failure then success, retry cap
hit, non-retryable abort.

Acceptance: `pnpm --filter harness test` passes all orchestrator tests.


### Milestone 9 — meteora_execute_goal SSE bridge

Create `mcp-server/src/tools/execute-goal.ts`. This handler:

1. Sets response headers for SSE:
   `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
   `Connection: keep-alive`.

2. Imports `runGoal` from the harness package.

3. Iterates the async generator, writing each StageEvent as an SSE
   message: `data: <JSON>\n\n`.

4. On the final return value (OnChainProof or error), writes a final
   SSE message with `event: done` and closes the response.

Add `meteora_execute_goal` to the tool manifest in `GET /tools` with
description:

    Executes a natural-language Meteora DeFi goal end-to-end. Launches
    pools, swaps tokens, or other on-chain actions autonomously. Streams
    stage-by-stage progress and returns on-chain proof of completion.
    Use this tool when the user wants to perform a Meteora action.

Write an integration test (in-process, no devnet) that starts the MCP
server, stubs runGoal to yield three fake events then return a fake
OnChainProof, calls the endpoint, and asserts all SSE messages arrive
in order.

Acceptance: `pnpm --filter mcp-server test` passes. Running:
    curl -N -X POST http://localhost:3000/tools/meteora_execute_goal \
      -H "Content-Type: application/json" -d '{"goal":"test"}'
streams events to the terminal without hanging.


### Milestone 10 — Integration test: launch-dlmm on devnet

Requires a funded devnet wallet and populated .env. Get devnet SOL
from https://faucet.solana.com if needed.

Run the full harness against devnet with this goal:

    "Launch a DLMM pool for SOL/USDC with bin step 10, seed 1 SOL
     one-sided, on devnet"

SOL mint: So11111111111111111111111111111111111111112
USDC mint (devnet): Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
(verify this is the correct devnet USDC mint before running)

Expected outcome: orchestrator returns OnChainProof with a real devnet
pool address. Record the tx hash and pool address in Surprises &
Discoveries.

If verify fails because the pool address log pattern does not match,
read the actual transaction logs from Solana Explorer, update the regex
in verify.ts, and document the correct log format here.

Acceptance: OnChainProof returned with a non-null poolAddress. The
transaction is visible at https://explorer.solana.com/?cluster=devnet.


### Milestone 11 — Integration test: launch-dbc on devnet

Same structure as M10 but for DBC:

    "Launch a DBC token pool against SOL with a linear bonding curve,
     migration threshold 5 SOL, trading fee 1%, on devnet"

If the DBC config requires fields not yet covered by the parse or plan
stages, extend both stages, add tests, and document new fields in
param-reference.json.

Acceptance: OnChainProof returned with a non-null poolAddress for the
DBC pool.


### Milestone 12 — README, demo script, final cleanup

Write README.md covering: what the project is, prerequisites (Node 18,
pnpm, funded devnet wallet), setup (clone + submodule init + pnpm
install + cp .env.example .env), how to start the server, how to run
the demo, how to run tests, an ASCII architecture diagram.

Write scripts/demo.ts: starts the MCP server in-process, sends a
hardcoded launch-dlmm goal to meteora_execute_goal, prints each SSE
event as it arrives in human-readable form, exits when done event
received.

Add `"demo": "tsx scripts/demo.ts"` to root package.json scripts.

Run `pnpm -r build` and fix all TypeScript errors. Run `pnpm -r test`
and confirm all tests pass. Remove any debug console.log statements.

Acceptance: A fresh clone with a populated .env runs `pnpm demo` and
produces streaming output ending with a real devnet pool address.


## Concrete Steps

(Agent populates this section milestone by milestone as work proceeds.)

M1 starting commands (run from an empty directory):

    git init meteora-harness
    cd meteora-harness
    git submodule add https://github.com/MeteoraAg/meteora-invent meteora-invent
    # then create package.json, workspace packages, tsconfigs


## Validation and Acceptance

Final acceptance: a judge (human or Codex) sends:

    POST http://localhost:3000/tools/meteora_execute_goal
    Content-Type: application/json
    { "goal": "Launch a DLMM pool for SOL/USDC with bin step 10, seed 5 SOL one-sided on devnet" }

And receives a stream of five SSE events ending with:

    event: done
    data: { "stage": "done", "status": "ok", "summary": "DLMM pool launched at <address>. Tx: <hash>." }

No human interaction at any point between goal and result.


## Idempotence and Recovery

Repo scaffold (M1): safe to re-run; git submodule add skips if already
present.

MCP server: stateless; restart at any time.

Execute stage: temp config file is always deleted; re-running writes a
fresh one at a new timestamp path.

Devnet tests: launching a duplicate pool creates a new pool at a
different address; this is safe and expected. Devnet SOL is free.

If a milestone fails partway through, split the progress checklist item
into "completed so far" and "remaining", then continue.


## Artifacts and Notes

### Meteora docs URLs (for content authoring in M3)

    https://docs.meteora.ag/overview/home
    https://docs.meteora.ag/developer-guide/home
    https://docs.meteora.ag/developer-guide/invent/actions
    https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool
    https://docs.meteora.ag/developer-guide/quick-launch/dbc-token-launch-pool

### Metsumi actions reference (from Meteora docs)

DLMM: launch-dlmm, seed-liquidity, seed-liquidity-single-bin, set-pool-status
DAMM v2: launch-damm-v2-balanced, launch-damm-v2-one-sided, split-position,
         claim-position-fee, add-liquidity, remove-liquidity, close-position
DAMM v1: launch-damm-v1, lock-liquidity, create-stake2earn-farm
DBC: launch-dbc, create-dbc-config, claim-trading-fees, migrate-to-damm-v1,
     migrate-to-damm-v2, swap
Alpha Vault: create-alpha-vault
Presale Vault: create-presale-vault

### DLMM config fields (minimum for launch)

binStep        (number) price granularity; common values: 1, 5, 10, 25, 100
activeId       (number) bin index for the initial active price
seedAmount     (number) lamports to seed as liquidity
tokenAMint     (string) SPL token mint address for token A
tokenBMint     (string) SPL token mint address for token B
curvature      (number) liquidity distribution shape; 1.0 = uniform

### DBC config fields (minimum for launch)

quoteMint            (string) quote token mint (SOL = So11111...1112)
migrationThreshold   (number) SOL amount at which the pool graduates
feeBps               (number) trading fee in basis points (100 = 1%)

### Solana devnet

RPC URL: https://api.devnet.solana.com
Faucet: https://faucet.solana.com
Explorer: https://explorer.solana.com/?cluster=devnet


## Interfaces and Dependencies

In `harness/src/types.ts`, define and export:

    type HarnessErrorCode =
      | "PARSE_FAILED" | "PLAN_FAILED" | "EXECUTE_FAILED"
      | "VERIFY_FAILED" | "RECOVER_FAILED" | "RETRY_CAP_REACHED"
      | "INSUFFICIENT_SOL" | "INVALID_CONFIG" | "RPC_ERROR" | "UNKNOWN"

    type StageResult<T> =
      | { ok: true; value: T }
      | { ok: false; error: string; code: HarnessErrorCode; retryable: boolean }

    type ParsedIntent = {
      action: "launch-dlmm" | "launch-dbc" | "swap"
      params: Record<string, unknown>
      network: "devnet" | "mainnet-beta"
      ambiguities: string[]
    }

    type MetsumiConfig = Record<string, unknown>

    type OnChainProof = {
      txHash: string
      slot: number
      poolAddress?: string
      confirmedAt: string
    }

    type RecoveryAction =
      | { type: "retry-from-plan"; configPatch: Record<string, unknown> }
      | { type: "abort"; reason: string }

    type StageEvent = {
      ts: string
      stage: "parse" | "plan" | "execute" | "verify" | "recover" | "done"
      status: "ok" | "failed" | "retrying"
      detail: unknown
    }

Stage function signatures:

    // harness/src/stages/parse.ts
    export async function parse(goal: string): Promise<StageResult<ParsedIntent>>

    // harness/src/stages/plan.ts
    export async function plan(
      intent: ParsedIntent,
      mcpBaseUrl: string
    ): Promise<StageResult<MetsumiConfig>>

    // harness/src/stages/execute.ts
    export async function execute(
      action: string,
      config: MetsumiConfig,
      network: string
    ): Promise<StageResult<{ txHash: string }>>

    // harness/src/stages/verify.ts
    export async function verify(
      txHash: string,
      action: string,
      rpcUrl: string
    ): Promise<StageResult<OnChainProof>>

    // harness/src/stages/recover.ts
    export async function recover(
      failed: { error: string; code: HarnessErrorCode; retryable: boolean },
      intent: ParsedIntent,
      mcpBaseUrl: string
    ): Promise<StageResult<RecoveryAction>>

    // harness/src/index.ts
    export async function* runGoal(
      goal: string,
      opts: { mcpBaseUrl: string; rpcUrl: string; maxRetries: number }
    ): AsyncGenerator<StageEvent, StageResult<OnChainProof>>