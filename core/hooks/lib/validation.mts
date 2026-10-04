import auditSchema from "../../registry/audit-event.schema.json" with {
  type: "json",
};
import inputSchema from "../../registry/hook-input.schema.json" with {
  type: "json",
};
import resultSchema from "../../registry/hook-result.schema.json" with {
  type: "json",
};
import knowledgeSchema from "../../registry/knowledge-index.schema.json" with {
  type: "json",
};
import { readTokens } from "./measure.mjs";

/** This evaluator supports only the vocabulary used by these three registries. It is not a general JSON Schema implementation. Ajv parity is checked in tests. */
export type Schema = {
  $schema?: string;
  $id?: string;
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  minLength?: number;
  pattern?: string;
  minimum?: number;
  oneOf?: Schema[];
  allOf?: Schema[];
  if?: Schema;
  then?: Schema;
  else?: Schema;
};

const keywords = new Set([
  "$schema",
  "$id",
  "$ref",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minLength",
  "minItems",
  "pattern",
  "minimum",
  "oneOf",
  "allOf",
  "if",
  "then",
  "else",
]);

const types = new Set(["object", "array", "integer", "string", "boolean"]);

/** Reject unsupported vocabulary before evaluation. Every hook start walks the whole registries, so the walk allocates no per-node arrays (see docs/development/hook-startup.md). */
export function assertSupportedSchema(schema: Schema): void {
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key))
      throw new Error(`REG-1: unsupported schema keyword ${key}`);
  }
  if (schema.$ref && schema.$ref !== auditSchema.$id)
    throw new Error("REG-1: unsupported reference");
  if (
    schema.type &&
    !(Array.isArray(schema.type)
      ? schema.type.every((type) => types.has(type))
      : types.has(schema.type))
  )
    throw new Error("REG-1: unsupported schema type");
  if (schema.properties)
    for (const key of Object.keys(schema.properties))
      assertSupportedSchema(schema.properties[key] as Schema);
  if (schema.oneOf)
    for (const child of schema.oneOf) assertSupportedSchema(child);
  if (schema.allOf)
    for (const child of schema.allOf) assertSupportedSchema(child);
  if (schema.items) assertSupportedSchema(schema.items);
  if (schema.if) assertSupportedSchema(schema.if);
  if (schema.then) assertSupportedSchema(schema.then);
  if (schema.else) assertSupportedSchema(schema.else);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function typed(type: string, value: unknown) {
  switch (type) {
    case "object":
      return object(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      throw new Error(`REG-1: unsupported schema type ${type}`);
  }
}

/** @param value Code points, as minLength counts them, without an array copy. */
function codePoints(value: string) {
  let length = 0;
  for (const _ of value) length++;
  return length;
}

/** Hooks validate the input and every audit line on each run, so the walk avoids per-node arrays; the checks and their order are unchanged. */
function matches(schema: Schema, value: unknown): boolean {
  // Reject the other audit variants before walking shared fields. The matching
  // variant still receives every check below; nonliteral legacy types do too.
  if (
    object(value) &&
    Object.hasOwn(value, "type") &&
    schema.properties?.type &&
    Object.hasOwn(schema.properties.type, "const") &&
    value.type !== schema.properties.type.const
  )
    return false;
  if (schema.$ref && !matches(auditSchema, value)) return false;
  if (
    schema.type &&
    !(Array.isArray(schema.type) ? schema.type : [schema.type]).some((type) =>
      typed(type, value),
    )
  )
    return false;
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && codePoints(value) < schema.minLength)
      return false;
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
      return false;
  }
  if (
    typeof value === "number" &&
    schema.minimum !== undefined &&
    value < schema.minimum
  )
    return false;
  if (object(value)) {
    if (schema.required?.some((key) => !Object.hasOwn(value, key)))
      return false;
    for (const key of Object.keys(value)) {
      const property =
        schema.properties && Object.hasOwn(schema.properties, key)
          ? schema.properties[key]
          : undefined;
      if (property && !matches(property, value[key])) return false;
      if (!property && schema.additionalProperties === false) return false;
    }
  }
  if (
    Array.isArray(value) &&
    schema.minItems !== undefined &&
    value.length < schema.minItems
  )
    return false;
  if (
    Array.isArray(value) &&
    schema.items &&
    !value.every((item) => matches(schema.items as Schema, item))
  )
    return false;
  if (schema.oneOf) {
    let matched = 0;
    for (const child of schema.oneOf) if (matches(child, value)) matched++;
    if (matched !== 1) return false;
  }
  if (schema.allOf && !schema.allOf.every((child) => matches(child, value)))
    return false;
  if (schema.if) {
    const branch = matches(schema.if, value) ? schema.then : schema.else;
    if (branch && !matches(branch, value)) return false;
  }
  return true;
}

for (const schema of [inputSchema, auditSchema, resultSchema, knowledgeSchema])
  assertSupportedSchema(schema);

export function parseInput(
  text: string,
): import("./contracts.mjs").HookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!matches(inputSchema, value) || !object(value)) return null;
  const tokens = readTokens(value);
  return {
    ...Object.fromEntries(
      Object.entries(value).filter(([key]) =>
        Object.hasOwn(inputSchema.properties, key),
      ),
    ),
    ...(tokens ? { tokens } : {}),
  } as import("./contracts.mjs").HookInput;
}

export function isAuditEvent(
  value: unknown,
): value is import("./contracts.mjs").AuditEvent {
  return matches(auditSchema, value);
}

export function isHookResult(
  value: unknown,
): value is import("./contracts.mjs").HookResult {
  return matches(resultSchema, value);
}

export function isKnowledgeIndex(
  value: unknown,
): value is import("./knowledge.mjs").Index {
  return matches(knowledgeSchema, value);
}
