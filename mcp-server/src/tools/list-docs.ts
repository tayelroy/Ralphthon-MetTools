import { listDocs as listDocsFromStore } from '../docs.js';

/** Returns the Meteora documentation index, optionally filtered by keyword. */
export async function listDocs(filter?: string) {
  return await listDocsFromStore(filter);
}
