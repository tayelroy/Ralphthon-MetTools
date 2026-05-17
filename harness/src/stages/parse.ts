import OpenAI from 'openai';
import type { ParsedIntent, StageResult } from '../types.js';

const SYSTEM_PROMPT = `You are a Meteora DeFi intent parser. Extract the intended on-chain
action and its parameters from the user's goal. Supported actions are:
launch-dlmm, launch-dbc, swap. Return only valid JSON matching this
schema: { action, params: Record<string,unknown>, network, ambiguities:
string[] }. network defaults to "devnet" if not specified. If a
parameter is mentioned but its value is unclear, add the param name to
ambiguities. If the action is not one of the three supported actions,
return { error: "unsupported action" }. `;

function extractJson(content: string): string {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fence?.[1] ?? content).trim();
}

function createClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/** Extracts a structured intent from a natural-language goal. */
export async function parse(goal: string): Promise<StageResult<ParsedIntent>> {
  try {
    const client = createClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: goal },
      ],
      temperature: 0,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('empty model response');
    const parsed = JSON.parse(extractJson(content)) as unknown;
    if (!parsed || typeof parsed !== 'object' || 'error' in parsed) throw new Error('unsupported action');
    const intent = parsed as ParsedIntent;
    return { ok: true, value: intent };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'parse failure',
      code: 'PARSE_FAILED',
      retryable: false,
    };
  }
}
