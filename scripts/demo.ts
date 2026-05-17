import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadPrivateKey } from '../harness/src/lib/private-key.js';
import { createApp } from '../mcp-server/src/index.js';

const rootDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(rootDir, '../.env') });

async function postJson(url: string, body: unknown): Promise<Response> {
  return await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const privateKey = await loadPrivateKey();
  if (!privateKey) {
    throw new Error('missing PRIVATE_KEY or KEYPAIR_FILE');
  }
  process.env.PRIVATE_KEY = privateKey;

  const app = await createApp();
  const server = createServer(app as never);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to start demo server');

  const baseUrl = `http://127.0.0.1:${address.port}`;

  const manifest = await postJson(`${baseUrl}/tools/meteora_list_docs`, { filter: 'launch pool' });
  if (!manifest.ok) throw new Error(`manifest check failed: ${manifest.status}`);

  const schemaResponse = await postJson(`${baseUrl}/tools/meteora_get_action_schema`, { action: 'launch-dlmm' });
  if (!schemaResponse.ok) throw new Error(`schema check failed: ${schemaResponse.status}`);

  const goal = process.env.DEMO_GOAL ?? 'Launch a DLMM pool for SOL/USDC with bin step 10, seed 5 SOL one-sided on devnet';
  const response = await postJson(`${baseUrl}/tools/meteora_execute_goal`, { goal });
  if (!response.body) throw new Error('missing response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const dataLine = part.split('\n').find((line) => line.startsWith('data: '));
      if (dataLine) console.log(dataLine.slice(6));
    }
  }

  server.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
