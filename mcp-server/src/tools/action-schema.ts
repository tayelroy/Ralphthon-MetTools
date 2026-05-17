import { getActionSchema as getActionSchemaFromStore, type ActionName } from '../docs.js';

export type { ActionName } from '../docs.js';

/** Returns config fields for a Meteora quick-launch action. */
export async function getActionSchema(action: ActionName) {
  return await getActionSchemaFromStore(action);
}
