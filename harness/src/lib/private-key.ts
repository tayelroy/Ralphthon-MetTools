import { promises as fs } from 'node:fs';

/**
 * Loads the harness private key from PRIVATE_KEY or a keypair file.
 *
 * The file path defaults to ./keypair.json and the file contents are returned
 * verbatim so the caller can assign them to PRIVATE_KEY.
 */
export async function loadPrivateKey(): Promise<string | undefined> {
  const envKey = process.env.PRIVATE_KEY?.trim();
  if (envKey) return envKey;

  const keypairFile = process.env.KEYPAIR_FILE?.trim() || './keypair.json';
  try {
    const content = await fs.readFile(keypairFile, 'utf8');
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
