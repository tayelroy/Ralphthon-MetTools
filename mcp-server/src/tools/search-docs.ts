import { searchDocs as searchDocsFromStore } from '../docs.js';

/** Searches cached docs content and uncached titles for a keyword. */
export async function searchDocs(query: string) {
  return await searchDocsFromStore(query);
}
