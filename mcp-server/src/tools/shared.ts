import { z } from "zod";

export type JsonObject = Record<string, unknown>;

/** Ensures the tool response always includes a source URL. */
export type ToolResponse = JsonObject & { source: string };

/** Creates a standard tool response object with a source URL. */
export function withSource<T extends JsonObject>(payload: T, source: string): T & { source: string } {
  return { ...payload, source };
}

/** Minimal JSON schema representation used by the server. */
export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  format?: string;
};

/** Converts a JSON Schema into a Zod schema for validation. */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  if (Array.isArray(schema.type)) {
    const options = schema.type.map((type) => jsonSchemaToZod({ ...schema, type }));
    return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  switch (schema.type) {
    case 'object': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        const child = jsonSchemaToZod(value);
        shape[key] = schema.required?.includes(key) ? child : child.optional();
      }
      let obj = z.object(shape);
      if (schema.additionalProperties === false) {
        obj = obj.strict();
      } else {
        obj = obj.passthrough();
      }
      return obj;
    }
    case 'array':
      return z.array(jsonSchemaToZod(schema.items ?? { type: 'unknown' }));
    case 'string':
      return schema.enum ? z.enum(schema.enum.filter((v): v is string => typeof v === 'string') as [string, ...string[]]) : z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'unknown':
    default:
      return z.unknown();
  }
}
