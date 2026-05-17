export type DocIndexEntry = {
  title: string;
  url: string;
};

export type CachedDoc = {
  title: string;
  url: string;
  content: string;
};

export type ConfigField = {
  name: string;
  type: string;
  description: string;
  required: boolean;
};

export type ActionName = 'launch-dlmm' | 'launch-dbc' | 'launch-damm-v1' | 'launch-damm-v2';

export type ActionSchemaResponse = {
  action: ActionName;
  configFields: ConfigField[];
  sourceUrl: string;
  schema: JsonSchema;
  example: Record<string, unknown>;
};

export type ResolveParamResponse = {
  action: ActionName;
  param: string;
  explanation: string;
  sourceUrl: string;
  validValues?: string[];
};

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  format?: string;
};

const LLMS_URL = 'https://docs.meteora.ag/llms.txt';
const QUICK_LAUNCH_URLS: Record<ActionName, string> = {
  'launch-dlmm': 'https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md',
  'launch-dbc': 'https://docs.meteora.ag/developer-guide/quick-launch/dbc-token-launch-pool.md',
  'launch-damm-v1': 'https://docs.meteora.ag/developer-guide/quick-launch/damm-v1-launch-pool.md',
  'launch-damm-v2': 'https://docs.meteora.ag/developer-guide/quick-launch/damm-v2-launch-pool.md',
};

const PARAM_REFERENCE: Record<string, { explanation: string; validValues?: string[] }> = {
  binStep: {
    explanation: 'Price increment/decrement percentage in basis points. It controls price granularity and the spacing between bins.',
    validValues: ['1', '5', '10', '25', '100', '400'],
  },
  activeId: {
    explanation: 'Bin index for the initial active price. It identifies the starting price bucket for the DLMM pool.',
  },
  initialPrice: {
    explanation: 'Initial price in quote/base terms used when creating a new pool.',
  },
  seedAmount: {
    explanation: 'Amount of liquidity to seed into the pool, in token units.',
  },
  tokenAMint: {
    explanation: 'SPL token mint address for token A, usually the base or traded token in the launch flow.',
  },
  tokenBMint: {
    explanation: 'SPL token mint address for token B, usually the quote token in the launch flow.',
  },
  migrationThreshold: {
    explanation: 'SOL threshold at which a DBC pool graduates or migrates.',
  },
  feeBps: {
    explanation: 'Trading fee in basis points.',
    validValues: ['1', '10', '25', '100', '200'],
  },
  quoteMint: {
    explanation: 'Quote token mint used by the launch flow, such as SOL or USDC.',
    validValues: ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
  },
  curvature: {
    explanation: 'Distribution shape for seeded liquidity. Lower values concentrate liquidity more tightly; 1.0 is uniform.',
  },
};

let indexPromise: Promise<DocIndexEntry[]> | undefined;
const docCache = new Map<string, CachedDoc>();

function canonicalizeDocsUrl(url: string): string {
  const parsed = new URL(url, LLMS_URL);
  if (!parsed.pathname.endsWith('.md')) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}.md`;
  }
  return parsed.toString();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function parseIndex(text: string): DocIndexEntry[] {
  const pages: DocIndexEntry[] = [];
  const linkPattern = /^-\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(linkPattern);
    if (!match) continue;
    pages.push({ title: match[1].trim(), url: match[2].trim() });
  }

  return pages;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractMarkdownTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function titleFromUrl(url: string): string {
  const parsed = new URL(url, LLMS_URL);
  const slug = parsed.pathname.split('/').filter(Boolean).pop() ?? parsed.pathname;
  return slug.replace(/\.md$/, '').replace(/[-_]+/g, ' ').trim() || url;
}

function buildExcerpt(text: string, query: string): string {
  const source = normalizeText(text);
  const needle = query.trim();
  if (!needle) return source.slice(0, 160);

  const lowerSource = source.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const index = lowerSource.indexOf(lowerNeedle);
  if (index < 0) {
    return source.slice(0, 160);
  }

  const start = Math.max(0, index - 80);
  const end = Math.min(source.length, index + needle.length + 80);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < source.length ? '…' : '';
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const withoutTrailing = body.endsWith('|') ? body.slice(0, -1) : body;
  return withoutTrailing.split('|').map((cell) => cell.trim());
}

function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmed);
}

type MarkdownTable = {
  header: string[];
  rows: string[][];
};

function parseMarkdownTables(content: string): MarkdownTable[] {
  const lines = content.split(/\r?\n/);
  const tables: MarkdownTable[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]?.trim() ?? '';
    const separatorLine = lines[index + 1]?.trim() ?? '';
    if (!headerLine.includes('|') || !isTableSeparatorRow(separatorLine)) continue;

    const header = splitTableRow(headerLine);
    if (header.length < 2) continue;

    const rows: string[][] = [];
    let cursor = index + 2;
    while (cursor < lines.length) {
      const rowLine = lines[cursor].trim();
      if (!rowLine || !rowLine.includes('|')) break;
      if (isTableSeparatorRow(rowLine)) {
        cursor += 1;
        continue;
      }
      const row = splitTableRow(rowLine);
      if (row.length >= 2) rows.push(row);
      cursor += 1;
    }

    if (rows.length > 0) {
      tables.push({ header, rows });
    }

    index = cursor - 1;
  }

  return tables;
}

function normalizeHeaderName(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeSchemaType(type: string): string {
  const known = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
  return known.has(type) ? type : 'string';
}

function exampleForType(type: string): unknown {
  switch (normalizeSchemaType(type)) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'null':
      return null;
    default:
      return '';
  }
}


function cellText(cell?: string): string {
  return normalizeText((cell ?? '').replace(/`/g, ''));
}

function inferRequiredFromText(text: string): boolean {
  return /\brequired\b/i.test(text) && !/\boptional\b/i.test(text);
}

function extractTypeFromText(text: string): string | undefined {
  const normalized = cellText(text);
  if (!normalized) return undefined;

  const codeMatch = normalized.match(/^`([^`]+)`$/);
  if (codeMatch) {
    return codeMatch[1].trim();
  }

  const firstToken = normalized.split(/\s+/)[0]?.toLowerCase();
  const knownTypes = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'enum', 'null']);
  if (firstToken && knownTypes.has(firstToken)) {
    return firstToken;
  }

  if (/^\w+(?:\[\])?$/.test(firstToken ?? '') && /\btype\b/i.test(normalized)) {
    return firstToken;
  }

  return undefined;
}

function inferTypeFromExample(example: string): string {
  const value = cellText(example);
  if (!value) return 'string';
  if (value.startsWith('[')) return 'array';
  if (value.startsWith('{')) return 'object';
  if (value === 'true' || value === 'false') return 'boolean';
  if (/^-?\d+$/.test(value)) return 'integer';
  if (/^-?\d*\.\d+(?:e[+-]?\d+)?$/i.test(value) || /^-?\d+(?:e[+-]?\d+)$/i.test(value)) return 'number';
  return 'string';
}

function parseConfigFieldsFromMarkdownTables(content: string): ConfigField[] {
  const fields: ConfigField[] = [];

  for (const table of parseMarkdownTables(content)) {
    const normalizedHeaders = table.header.map(normalizeHeaderName);
    const nameIndex = normalizedHeaders.findIndex((header) => /^(field|name|parameter|config field|property)$/.test(header));
    if (nameIndex < 0) continue;

    const typeIndex = normalizedHeaders.findIndex((header) => /^(type|value type|field type)$/.test(header));
    const descriptionIndex = normalizedHeaders.findIndex((header) => /^(description|details|notes?)$/.test(header));
    const exampleIndex = normalizedHeaders.findIndex((header) => /^(example|examples|sample|default|value)$/.test(header));

    for (const row of table.rows) {
      const name = cellText(row[nameIndex]);
      if (!name || /^-+$/.test(name)) continue;

      const typeSource = typeIndex >= 0 ? cellText(row[typeIndex]) : '';
      const descriptionSource = descriptionIndex >= 0 ? cellText(row[descriptionIndex]) : '';
      const exampleSource = exampleIndex >= 0 ? cellText(row[exampleIndex]) : '';
      const combinedTail = row
        .filter((_, index) => index !== nameIndex && index !== typeIndex && index !== descriptionIndex && index !== exampleIndex)
        .map(cellText)
        .filter(Boolean)
        .join(' ');

      const type = extractTypeFromText(typeSource) ?? inferTypeFromExample(exampleSource) ?? 'string';
      const description = descriptionSource || combinedTail || typeSource || exampleSource || name.replace(/([a-z])([A-Z])/g, '$1 $2');
      const required = inferRequiredFromText([name, typeSource, descriptionSource, exampleSource, combinedTail].join(' '));

      fields.push({ name, type, description, required });
    }
  }

  return fields;
}

function inferType(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('{')) return 'object';
  if (value.startsWith('[')) return 'array';
  if (value === 'null') return 'null';
  if (value === 'true' || value === 'false') return 'boolean';
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return 'string';
  if (/^-?\d+$/.test(value)) return 'integer';
  if (/^-?\d*\.\d+(?:e[+-]?\d+)?$/i.test(value) || /^-?\d+(?:e[+-]?\d+)$/i.test(value)) return 'number';
  return 'unknown';
}

type SchemaTreeNode = {
  field?: ConfigField;
  children: Map<string, SchemaTreeNode>;
};

function createNode(): SchemaTreeNode {
  return { children: new Map() };
}

function insertField(root: SchemaTreeNode, field: ConfigField): void {
  const segments = field.name.split('.').map((segment) => segment.trim()).filter(Boolean);
  let node = root;
  for (const segment of segments) {
    const child = node.children.get(segment) ?? createNode();
    node.children.set(segment, child);
    node = child;
  }
  node.field = field;
}

function buildSchemaTree(fields: ConfigField[]): { schema: JsonSchema; example: Record<string, unknown> } {
  const root = createNode();
  for (const field of [...fields].sort((left, right) => left.name.localeCompare(right.name))) {
    insertField(root, field);
  }

  const buildNode = (node: SchemaTreeNode): { schema: JsonSchema; example: unknown; required: boolean } => {
    const field = node.field;
    if (node.children.size === 0) {
      const type = normalizeSchemaType(field?.type ?? 'string');
      return {
        schema: { type, description: field?.description },
        example: exampleForType(type),
        required: Boolean(field?.required),
      };
    }

    const properties: Record<string, JsonSchema> = {};
    const example: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, child] of [...node.children.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const built = buildNode(child);
      properties[name] = built.schema;
      example[name] = built.example;
      if (built.required) required.push(name);
    }

    const schema: JsonSchema = {
      type: 'object',
      description: field?.description,
      properties,
      additionalProperties: true,
    };
    if (required.length > 0) schema.required = required;
    return { schema, example, required: Boolean(field?.required) || required.length > 0 };
  };

  const built = buildNode(root);
  return {
    schema: {
      type: 'object',
      properties: built.schema.properties ?? {},
      required: built.schema.required,
      additionalProperties: true,
    },
    example: built.example as Record<string, unknown>,
  };
}


function humanizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
}

function cleanCommentText(text: string): string {
  return normalizeText(
    text
      .replace(/^\/\*+/, '')
      .replace(/\*+\/$/, '')
      .replace(/^\s*\*\s?/gm, ' ')
      .replace(/^\s*\/\/\s?/gm, ' ')
      .replace(/\s+/g, ' '),
  );
}

function parseConfigFieldsFromJsonc(codeBlock: string): ConfigField[] {
  const fields: ConfigField[] = [];
  const stack: string[] = [];
  const lines = codeBlock.split(/\r?\n/);
  let commentBuffer: string[] = [];
  let inBlockComment = false;

  const takeComment = (inlineComment?: string): string => {
    const parts = [...commentBuffer];
    commentBuffer = [];
    if (inlineComment) parts.push(inlineComment.trim());
    return cleanCommentText(parts.join(' '));
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (inBlockComment) {
      const endIndex = line.indexOf('*/');
      if (endIndex >= 0) {
        const segment = line.slice(0, endIndex).replace(/^\s*\*\s?/, '');
        if (segment.trim()) commentBuffer.push(segment.trim());
        inBlockComment = false;
        const trailing = line.slice(endIndex + 2).trim();
        if (trailing.startsWith('//')) {
          commentBuffer.push(trailing.slice(2).trim());
        }
      } else {
        commentBuffer.push(line.replace(/^\s*\*\s?/, '').trim());
      }
      continue;
    }

    if (line.startsWith('//')) {
      commentBuffer.push(line.slice(2).trim());
      continue;
    }

    if (line.startsWith('/*')) {
      const endIndex = line.indexOf('*/', 2);
      if (endIndex >= 0) {
        const content = line.slice(2, endIndex).trim();
        if (content) commentBuffer.push(content);
      } else {
        const content = line.slice(2).trim();
        if (content) commentBuffer.push(content);
        inBlockComment = true;
      }
      continue;
    }

    if (line.startsWith('*')) {
      commentBuffer.push(line.replace(/^\*\s?/, '').trim());
      continue;
    }

    if (/^[}\]]+,?$/.test(line)) {
      const closeCount = (line.match(/[}\]]/g) ?? []).length;
      for (let index = 0; index < closeCount; index += 1) {
        stack.pop();
      }
      continue;
    }

    const match = line.match(/^"([^"]+)"\s*:\s*(.+?)(,?)\s*(?:\/\/\s*(.*))?$/);
    if (!match) continue;

    const [, key, rawValue, , inlineComment] = match;
    const type = inferType(rawValue);
    const description = takeComment(inlineComment) || humanizeKey(key);
    const required = /\brequired\b/i.test(description) && !/\boptional\b/i.test(description);
    fields.push({
      name: [...stack, key].join('.'),
      type,
      description,
      required,
    });

    if (type === 'object') {
      stack.push(key);
    }
  }

  return fields;
}

function extractJsoncBlock(content: string): string {
  const match = content.match(/^\s*```jsonc[^\n]*\n([\s\S]*?)^\s*```/m);
  if (!match) {
    throw new Error('failed to locate JSONC config block in docs page');
  }
  return match[1];
}

function extractConfigFieldsFromDoc(content: string): ConfigField[] {
  const tableFields = parseConfigFieldsFromMarkdownTables(content);
  if (tableFields.length > 0) {
    return tableFields;
  }

  try {
    return parseConfigFieldsFromJsonc(extractJsoncBlock(content));
  } catch {
    return [];
  }
}

async function loadIndex(): Promise<DocIndexEntry[]> {
  const text = await fetchText(LLMS_URL);
  return parseIndex(text);
}

function getIndexPromise(): Promise<DocIndexEntry[]> {
  indexPromise ??= loadIndex();
  return indexPromise;
}

function findIndexTitle(url: string, pages: DocIndexEntry[]): string | undefined {
  return pages.find((page) => canonicalizeDocsUrl(page.url) === canonicalizeDocsUrl(url))?.title;
}

/** Preloads and returns the Meteora documentation index from llms.txt. */
export async function preloadDocs(): Promise<DocIndexEntry[]> {
  return await getIndexPromise();
}

/** Returns the full Meteora documentation index, optionally filtered by keyword. */
export async function listDocs(filter?: string): Promise<{ pages: DocIndexEntry[] }> {
  const pages = await getIndexPromise();
  const needle = filter?.trim().toLowerCase();
  const filtered = needle
    ? pages.filter((page) => `${page.title} ${page.url}`.toLowerCase().includes(needle))
    : pages;
  return { pages: filtered };
}

/** Fetches a single docs page, converts it to markdown, and caches the result in memory. */
export async function getDoc(url: string): Promise<CachedDoc> {
  const canonicalUrl = canonicalizeDocsUrl(url);
  const cached = docCache.get(canonicalUrl);
  if (cached) {
    return cached;
  }

  const [content, pages] = await Promise.all([fetchText(canonicalUrl), getIndexPromise()]);
  const title = extractMarkdownTitle(content) ?? findIndexTitle(canonicalUrl, pages) ?? titleFromUrl(canonicalUrl);
  const doc = { title, url: canonicalUrl, content };
  docCache.set(canonicalUrl, doc);
  return doc;
}

/** Searches cached docs content and uncached titles for a keyword. */
export async function searchDocs(query: string): Promise<{ results: Array<{ title: string; url: string; excerpt: string }> }> {
  const pages = await getIndexPromise();
  const needle = query.trim().toLowerCase();
  const results: Array<{ title: string; url: string; excerpt: string }> = [];

  for (const page of pages) {
    const titleMatch = `${page.title} ${page.url}`.toLowerCase().includes(needle);
    if (needle && titleMatch) {
      results.push({ title: page.title, url: page.url, excerpt: page.title });
      continue;
    }

    const cached = docCache.get(canonicalizeDocsUrl(page.url));
    if (cached) {
      const contentMatch = cached.content.toLowerCase().includes(needle);
      if (needle && contentMatch) {
        results.push({ title: cached.title, url: cached.url, excerpt: buildExcerpt(cached.content, query) });
      }
    }
  }

  return { results };
}

/** Fetches a quick-launch guide and returns the flattened config fields described by its JSONC example. */
export async function getActionSchema(action: ActionName): Promise<ActionSchemaResponse> {
  const sourceUrl = QUICK_LAUNCH_URLS[action];
  const doc = await getDoc(sourceUrl);
  const configFields = extractConfigFieldsFromDoc(doc.content);
  const { schema, example } = buildSchemaTree(configFields);
  return { action, configFields, sourceUrl: doc.url, schema, example };
}

/** Returns a docs-backed explanation for a parameter used in a quick-launch action. */
export async function resolveParam(action: ActionName, param: string): Promise<ResolveParamResponse> {
  const sourceUrl = QUICK_LAUNCH_URLS[action];
  const reference = PARAM_REFERENCE[param] ?? { explanation: `Parameter ${param} from the ${action} launch flow.` };

  return {
    action,
    param,
    explanation: reference.explanation,
    sourceUrl,
    validValues: reference.validValues,
  };
}
