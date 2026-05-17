import { withSource } from './tools/shared.js';

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
};

const LLMS_URL = 'https://docs.meteora.ag/llms.txt';
const QUICK_LAUNCH_URLS: Record<ActionName, string> = {
  'launch-dlmm': 'https://docs.meteora.ag/developer-guide/quick-launch/dlmm-launch-pool.md',
  'launch-dbc': 'https://docs.meteora.ag/developer-guide/quick-launch/dbc-token-launch-pool.md',
  'launch-damm-v1': 'https://docs.meteora.ag/developer-guide/quick-launch/damm-v1-launch-pool.md',
  'launch-damm-v2': 'https://docs.meteora.ag/developer-guide/quick-launch/damm-v2-launch-pool.md',
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

function parseConfigFields(codeBlock: string): ConfigField[] {
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
  const match = content.match(/```jsonc[^\n]*\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error('failed to locate JSONC config block in docs page');
  }
  return match[1];
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
export async function listDocs(filter?: string): Promise<{ pages: DocIndexEntry[]; source: string }> {
  const pages = await getIndexPromise();
  const needle = filter?.trim().toLowerCase();
  const filtered = needle
    ? pages.filter((page) => `${page.title} ${page.url}`.toLowerCase().includes(needle))
    : pages;
  return withSource({ pages: filtered }, LLMS_URL);
}

/** Fetches a single docs page, converts it to markdown, and caches the result in memory. */
export async function getDoc(url: string): Promise<CachedDoc & { source: string }> {
  const canonicalUrl = canonicalizeDocsUrl(url);
  const cached = docCache.get(canonicalUrl);
  if (cached) {
    return withSource(cached, canonicalUrl);
  }

  const [content, pages] = await Promise.all([fetchText(canonicalUrl), getIndexPromise()]);
  const title = extractMarkdownTitle(content) ?? findIndexTitle(canonicalUrl, pages) ?? titleFromUrl(canonicalUrl);
  const doc = { title, url: canonicalUrl, content };
  docCache.set(canonicalUrl, doc);
  return withSource(doc, canonicalUrl);
}

/** Searches cached docs content and uncached titles for a keyword. */
export async function searchDocs(query: string): Promise<{ results: Array<{ title: string; url: string; excerpt: string }>; source: string }> {
  const pages = await getIndexPromise();
  const needle = query.trim().toLowerCase();
  const results: Array<{ title: string; url: string; excerpt: string }> = [];

  for (const page of pages) {
    const cached = docCache.get(canonicalizeDocsUrl(page.url));
    if (cached) {
      const contentMatch = cached.content.toLowerCase().includes(needle);
      const titleMatch = cached.title.toLowerCase().includes(needle);
      if (needle && (contentMatch || titleMatch)) {
        const haystack = titleMatch ? cached.title : cached.content;
        results.push({ title: cached.title, url: cached.url, excerpt: buildExcerpt(haystack, query) });
      }
      continue;
    }

    const titleMatch = `${page.title} ${page.url}`.toLowerCase().includes(needle);
    if (needle && titleMatch) {
      results.push({ title: page.title, url: page.url, excerpt: page.title });
    }
  }

  return withSource({ results }, LLMS_URL);
}

/** Fetches a quick-launch guide and returns the flattened config fields described by its JSONC example. */
export async function getActionSchema(action: ActionName): Promise<ActionSchemaResponse & { source: string }> {
  const sourceUrl = QUICK_LAUNCH_URLS[action];
  const doc = await getDoc(sourceUrl);
  const configFields = parseConfigFields(extractJsoncBlock(doc.content));
  return withSource({ action, configFields, sourceUrl: doc.url }, doc.url);
}
