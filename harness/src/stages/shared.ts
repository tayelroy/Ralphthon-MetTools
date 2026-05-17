import { z } from 'zod';

/** Minimal JSON schema representation shared by harness stages. */
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

/** Deep clones a JSON-compatible value. */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Deep merges source into target recursively. */
export function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const targetChild = target[key];
      if (targetChild && typeof targetChild === 'object' && !Array.isArray(targetChild)) {
        target[key] = deepMerge(targetChild as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = deepClone(value);
      }
    } else {
      target[key] = value as unknown;
    }
  }
  return target;
}

/** Recursively sets the first matching key inside an object tree. */
export function setFirstMatchingKey(target: Record<string, unknown>, key: string, value: unknown): boolean {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = value;
    return true;
  }

  for (const child of Object.values(target)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      if (setFirstMatchingKey(child as Record<string, unknown>, key, value)) return true;
    }
  }

  return false;
}

/** Converts a JSON Schema into a Zod schema. */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  if (Array.isArray(schema.type)) {
    const schemas = schema.type.map((type) => jsonSchemaToZod({ ...schema, type }));
    return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  switch (schema.type) {
    case 'object': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        const child = jsonSchemaToZod(value);
        shape[key] = schema.required?.includes(key) ? child : child.optional();
      }
      const objectSchema = z.object(shape);
      return schema.additionalProperties === false ? objectSchema.strict() : objectSchema.passthrough();
    }
    case 'array':
      return z.array(jsonSchemaToZod(schema.items ?? { type: 'unknown' }));
    case 'string':
      return schema.enum && schema.enum.length > 0
        ? z.enum(schema.enum.filter((item): item is string => typeof item === 'string') as [string, ...string[]])
        : z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    default:
      return z.unknown();
  }
}
