import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPrivateKey } from '../src/lib/private-key.js';

afterEach(() => {
  delete process.env.PRIVATE_KEY;
  delete process.env.KEYPAIR_FILE;
});

describe('loadPrivateKey', () => {
  it('prefers an explicit PRIVATE_KEY env var', async () => {
    process.env.PRIVATE_KEY = 'base58-secret';

    await expect(loadPrivateKey()).resolves.toBe('base58-secret');
  });

  it('loads the keypair file when PRIVATE_KEY is missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'meteora-keypair-'));
    const file = path.join(dir, 'keypair.json');
    const content = '[1,2,3,4]';
    await writeFile(file, `${content}\n`, 'utf8');
    process.env.KEYPAIR_FILE = file;

    await expect(loadPrivateKey()).resolves.toBe(content);

    await rm(dir, { recursive: true, force: true });
  });

  it('returns undefined when neither source exists', async () => {
    await expect(loadPrivateKey()).resolves.toBeUndefined();
  });
});
