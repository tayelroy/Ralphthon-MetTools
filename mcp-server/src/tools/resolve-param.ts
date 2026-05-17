import { resolveParam as resolveParamFromStore, type ActionName } from '../docs.js';

/** Returns docs-backed guidance for a launch parameter. */
export async function resolveParam(action: ActionName, param: string) {
  return await resolveParamFromStore(action, param);
}
