import OpenAI from 'openai';
import type { JsonSchema } from './shared.js';
import type { ParsedIntent, MetsumiConfig, StageResult } from '../types.js';
import { deepClone, jsonSchemaToZod, setFirstMatchingKey } from './shared.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function findSchemaForKey(schema: JsonSchema, key: string): JsonSchema | undefined {
  if (!schema.properties) return undefined;
  if (Object.prototype.hasOwnProperty.call(schema.properties, key)) {
    return schema.properties[key];
  }
  for (const child of Object.values(schema.properties)) {
    const found = findSchemaForKey(child, key);
    if (found) return found;
  }
  return undefined;
}

function coerceValueForSchema(schema: JsonSchema | undefined, value: unknown): unknown {
  const type = schema?.type;
  const normalizedType = Array.isArray(type) ? type[0] : type;
  if (normalizedType === 'string' && typeof value !== 'string') return String(value);
  if ((normalizedType === 'number' || normalizedType === 'integer') && typeof value === 'string') {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) return normalizedType === 'integer' ? Math.trunc(numeric) : numeric;
  }
  if (normalizedType === 'boolean' && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

function createClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function setNestedPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const next = asRecord(cursor[segment]);
    if (!next) {
      const created: Record<string, unknown> = {};
      cursor[segment] = created;
      cursor = created;
      continue;
    }
    cursor = next;
  }
  cursor[path[path.length - 1]] = value;
}

function getCandidate(params: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function isMintLike(value: unknown): value is string {
  return typeof value === 'string' && value.length > 20;
}

function normalizeQuoteMint(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.trim().toUpperCase();
  if (upper === 'SOL') return SOL_MINT;
  if (upper === 'USDC') return USDC_MINT;
  if (value === SOL_MINT || value === USDC_MINT) return value;
  if (isMintLike(value)) return value;
  return undefined;
}

function applyLaunchDlmmDefaults(config: MetsumiConfig, params: Record<string, unknown>, schema: JsonSchema): void {
  const rpcUrl = process.env.RPC_URL?.trim() || 'https://api.devnet.solana.com';
  const keypairFilePath = process.env.KEYPAIR_FILE?.trim() || './keypair.json';
  const tokenA = getCandidate(params, ['tokenA', 'tokenAMint']);
  const tokenB = getCandidate(params, ['tokenB', 'tokenBMint']);
  const baseToken = asRecord(getCandidate(params, ['createBaseToken', 'tokenB', 'baseToken'])) ?? asRecord(params.createBaseToken) ?? asRecord(params.baseToken);

  config.rpcUrl = rpcUrl;
  config.dryRun = false;
  config.keypairFilePath = keypairFilePath;
  config.computeUnitPriceMicroLamports = Number(config.computeUnitPriceMicroLamports ?? 0);

  const quoteMint = normalizeQuoteMint(getCandidate(params, ['quoteMint', 'quoteTokenMint', 'quote']))
    ?? normalizeQuoteMint(tokenA)
    ?? normalizeQuoteMint(tokenB)
    ?? SOL_MINT;
  config.quoteMint = quoteMint;

  const initialPrice = Number(getCandidate(params, ['initialPrice', 'price']) ?? 0.01);
  const dlmmBinStep = coerceValueForSchema({ type: 'integer' }, getCandidate(params, ['binStep'])) ?? 10;
  const dlmmFeeBps = coerceValueForSchema({ type: 'integer' }, getCandidate(params, ['feeBps'])) ?? 0;
  const dlmmActivationType = coerceValueForSchema({ type: 'integer' }, getCandidate(params, ['activationType'])) ?? 0;
  const dlmmActivationPoint = getCandidate(params, ['activationPoint']) ?? null;
  const dlmmPriceRounding = getCandidate(params, ['priceRounding']) ?? 'down';
  const dlmmHasAlphaVault = Boolean(getCandidate(params, ['hasAlphaVault']));
  const dlmmCreatorPoolOnOffControl = Boolean(getCandidate(params, ['creatorPoolOnOffControl']));

  // Guard each nested section on schema presence: create only when the schema defines the section.
  // This prevents synthetic nested paths from shadowing flat-schema keys in setFirstMatchingKey.
  if (findSchemaForKey(schema, 'dlmmConfig')) {
    const dlmmConfig = asRecord(config.dlmmConfig) ?? {};
    config.dlmmConfig = dlmmConfig;
    setNestedPath(dlmmConfig, ['binStep'], dlmmBinStep);
    setNestedPath(dlmmConfig, ['initialPrice'], initialPrice);
    setNestedPath(dlmmConfig, ['feeBps'], dlmmFeeBps);
    setNestedPath(dlmmConfig, ['activationType'], dlmmActivationType);
    setNestedPath(dlmmConfig, ['activationPoint'], dlmmActivationPoint);
    setNestedPath(dlmmConfig, ['priceRounding'], dlmmPriceRounding);
    setNestedPath(dlmmConfig, ['hasAlphaVault'], dlmmHasAlphaVault);
    setNestedPath(dlmmConfig, ['creatorPoolOnOffControl'], dlmmCreatorPoolOnOffControl);
  }

  if (findSchemaForKey(schema, 'createBaseToken')) {
    const createBaseToken = asRecord(config.createBaseToken) ?? {};
    config.createBaseToken = createBaseToken;
    const tokenName = getCandidate(params, ['name', 'tokenBName', 'baseTokenName']) ?? baseToken?.name;
    const tokenSymbol = getCandidate(params, ['symbol', 'tokenBSymbol', 'baseTokenSymbol']) ?? baseToken?.symbol;
    const tokenDecimals = getCandidate(params, ['decimals', 'tokenBDecimals', 'baseTokenDecimals']) ?? baseToken?.decimals;
    const tokenSupply = getCandidate(params, ['supply', 'tokenBSupply', 'baseTokenSupply']) ?? baseToken?.supply;
    const tokenDescription = getCandidate(params, ['description', 'tokenBDescription', 'baseTokenDescription']) ?? baseToken?.description;
    const tokenImage = getCandidate(params, ['image', 'tokenBImage']) ?? baseToken?.image;
    const tokenWebsite = getCandidate(params, ['website', 'tokenBWebsite']) ?? baseToken?.website;
    const tokenTwitter = getCandidate(params, ['twitter', 'tokenBTwitter']) ?? baseToken?.twitter;
    const tokenTelegram = getCandidate(params, ['telegram', 'tokenBTelegram']) ?? baseToken?.telegram;

    if (tokenName !== undefined) setNestedPath(createBaseToken, ['name'], tokenName);
    if (tokenSymbol !== undefined) setNestedPath(createBaseToken, ['symbol'], tokenSymbol);
    if (tokenDecimals !== undefined) setNestedPath(createBaseToken, ['decimals'], coerceValueForSchema({ type: 'integer' }, tokenDecimals) ?? tokenDecimals);
    if (tokenSupply !== undefined) setNestedPath(createBaseToken, ['supply'], coerceValueForSchema({ type: 'integer' }, tokenSupply) ?? tokenSupply);
    if (tokenDescription !== undefined) setNestedPath(createBaseToken, ['metadata', 'description'], tokenDescription);
    if (tokenImage !== undefined) setNestedPath(createBaseToken, ['metadata', 'image'], tokenImage);
    if (tokenWebsite !== undefined) setNestedPath(createBaseToken, ['metadata', 'website'], tokenWebsite);
    if (tokenTwitter !== undefined) setNestedPath(createBaseToken, ['metadata', 'twitter'], tokenTwitter);
    if (tokenTelegram !== undefined) setNestedPath(createBaseToken, ['metadata', 'telegram'], tokenTelegram);
  }

  const seedAmount = getCandidate(params, ['seedAmount', 'seed']) ?? 2;

  if (findSchemaForKey(schema, 'singleBinSeedLiquidity')) {
    const singleBinSeedLiquidity = asRecord(config.singleBinSeedLiquidity) ?? {};
    config.singleBinSeedLiquidity = singleBinSeedLiquidity;
    setNestedPath(singleBinSeedLiquidity, ['price'], initialPrice);
    setNestedPath(singleBinSeedLiquidity, ['seedAmount'], String(seedAmount));
    setNestedPath(singleBinSeedLiquidity, ['operatorKeypairFilepath'], keypairFilePath);
    setNestedPath(singleBinSeedLiquidity, ['priceRounding'], getCandidate(params, ['priceRounding']) ?? 'down');
    setNestedPath(singleBinSeedLiquidity, ['seedTokenXToPositionOwner'], Boolean(getCandidate(params, ['seedTokenXToPositionOwner'])));
  }

  if (findSchemaForKey(schema, 'lfgSeedLiquidity')) {
    const lfgSeedLiquidity = asRecord(config.lfgSeedLiquidity) ?? {};
    config.lfgSeedLiquidity = lfgSeedLiquidity;
    setNestedPath(lfgSeedLiquidity, ['seedAmount'], String(seedAmount));
    setNestedPath(lfgSeedLiquidity, ['curvature'], Number(getCandidate(params, ['curvature']) ?? 1));
    setNestedPath(lfgSeedLiquidity, ['operatorKeypairFilepath'], keypairFilePath);
  }
}

async function pickDefault(param: string, explanation: string, intent: ParsedIntent): Promise<unknown> {
  try {
    const client = createClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Choose a sensible JSON value for the requested Meteora config parameter. Return only JSON: { "param": string, "value": unknown, "reason": string }.',
        },
        { role: 'user', content: JSON.stringify({ param, explanation, intent }) },
      ],
      temperature: 0,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('empty model response');
    const parsed = JSON.parse(content) as { value?: unknown };
    return parsed.value;
  } catch {
    if (param === 'activeId') return 0;
    if (param === 'initialPrice') return 1;
    if (param === 'seedAmount') return 1;
    if (param === 'curvature') return 1;
    if (param === 'feeBps') return 100;
    if (param === 'migrationThreshold') return 5;
    return explanation;
  }
}

// Maps common LLM-output key names to the canonical Metsumi config field names.
const PARAM_ALIASES: Record<string, string> = {
  tokenName: 'name',
  token_name: 'name',
  tokenSymbol: 'symbol',
  token_symbol: 'symbol',
  tokenDecimals: 'decimals',
  token_decimals: 'decimals',
  totalSupply: 'supply',
  tokenSupply: 'supply',
  total_supply: 'supply',
  liquidityAmount: 'seedAmount',
  seedLiquidity: 'seedAmount',
  quoteMintAddress: 'quoteMint',
  quoteTokenMint: 'quoteMint',
  basePrice: 'initialPrice',
  startPrice: 'initialPrice',
};

function normalizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    out[PARAM_ALIASES[key] ?? key] = value;
  }
  return out;
}

/** Builds and validates a Metsumi config from parsed intent data. */
export async function plan(intent: ParsedIntent, mcpBaseUrl: string): Promise<StageResult<MetsumiConfig>> {
  try {
    const schemaResponse = await fetch(`${mcpBaseUrl}/tools/meteora_get_action_schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: intent.action }),
    });
    if (!schemaResponse.ok) throw new Error(`schema request failed: ${schemaResponse.status}`);

    const schemaBody = await schemaResponse.json() as { schema: JsonSchema; example: MetsumiConfig };
    const config = deepClone(schemaBody.example ?? {});
    const normalizedParams = normalizeParams(intent.params);

    for (const [key, value] of Object.entries(normalizedParams)) {
      const coerced = coerceValueForSchema(findSchemaForKey(schemaBody.schema, key), value);
      if (!setFirstMatchingKey(config, key, coerced)) config[key] = coerced;
    }

    if (intent.action === 'launch-dlmm') {
      applyLaunchDlmmDefaults(config, normalizedParams, schemaBody.schema);
    }

    for (const param of intent.ambiguities) {
      const resolveResponse = await fetch(`${mcpBaseUrl}/tools/meteora_resolve_param`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ param, action: intent.action }),
      });
      if (!resolveResponse.ok) throw new Error(`resolve request failed: ${resolveResponse.status}`);
      const resolved = await resolveResponse.json() as { explanation: string };
      const value = await pickDefault(param, resolved.explanation, intent);
      const coerced = coerceValueForSchema(findSchemaForKey(schemaBody.schema, param), value);
      if (!setFirstMatchingKey(config, param, coerced)) config[param] = coerced;
      console.error(`[plan] resolved ${param} -> ${JSON.stringify(coerced)}`);
    }

    const zodSchema = jsonSchemaToZod(schemaBody.schema);
    const parsed = zodSchema.safeParse(config);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message, code: 'INVALID_CONFIG', retryable: true };
    }

    return { ok: true, value: parsed.data as MetsumiConfig };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'plan failure',
      code: 'PLAN_FAILED',
      retryable: true,
    };
  }
}
