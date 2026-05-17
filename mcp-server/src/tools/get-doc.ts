import { getDoc as getDocFromStore } from '../docs.js';

/** Fetches a single docs page and returns its markdown content. */
export async function getDoc(url: string) {
  return await getDocFromStore(url);
}
