import auditSchema from "../../registry/audit-event.schema.json" with {
  type: "json",
};
import inputSchema from "../../registry/hook-input.schema.json" with {
  type: "json",
};
import resultSchema from "../../registry/hook-result.schema.json" with {
  type: "json",
};

/**
 * This evaluator supports only the vocabulary used by these three registries.
 * It is not a general JSON Schema implementation. Ajv parity is checked in tests.
 * @typedef {object} Schema
 * @property {string} [$schema]
 * @property {string} [$id]
 * @property {string} [$ref]
 * @property {string|string[]} [type]
 * @property {unknown} [const]
 * @property {unknown[]} [enum]
 * @property {Record<string,Schema>} [properties]
 * @property {string[]} [required]
 * @property {boolean} [additionalProperties]
 * @property {Schema} [items]
 * @property {number} [minLength]
 * @property {string} [pattern]
 * @property {number} [minimum]
 * @property {Schema[]} [oneOf]
 * @property {Schema[]} [allOf]
 * @property {Schema} [if]
 * @property {Schema} [then]
 * @property {Schema} [else]
 */

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
  "pattern",
  "minimum",
  "oneOf",
  "allOf",
  "if",
  "then",
  "else",
]);

/** @param {Schema} schema @returns {void} Reject unsupported vocabulary before evaluation. */
export function assertSupportedSchema(schema) {
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key))
      throw new Error(`REG-1: unsupported schema keyword ${key}`);
  }
  if (schema.$ref && schema.$ref !== auditSchema.$id)
    throw new Error("REG-1: unsupported reference");
  if (
    schema.type &&
    (Array.isArray(schema.type) ? schema.type : [schema.type]).some(
      (type) =>
        !["object", "array", "integer", "string", "boolean"].includes(type),
    )
  )
    throw new Error("REG-1: unsupported schema type");
  const children = [
    ...Object.values(schema.properties ?? {}),
    ...(schema.oneOf ?? []),
    ...(schema.allOf ?? []),
    schema.items,
    schema.if,
    schema.then,
    schema.else,
  ];
  for (const child of children) if (child) assertSupportedSchema(child);
}

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} type @param {unknown} value */
function typed(type, value) {
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

/** @param {Schema} schema @param {unknown} value @returns {boolean} */
function matches(schema, value) {
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
    if (schema.minLength !== undefined && [...value].length < schema.minLength)
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
    for (const [key, field] of Object.entries(value)) {
      const property = Object.hasOwn(schema.properties ?? {}, key)
        ? schema.properties?.[key]
        : undefined;
      if (property && !matches(property, field)) return false;
      if (!property && schema.additionalProperties === false) return false;
    }
  }
  if (
    Array.isArray(value) &&
    schema.items &&
    !value.every((item) => matches(/** @type {Schema} */ (schema.items), item))
  )
    return false;
  if (
    schema.oneOf &&
    schema.oneOf.filter((child) => matches(child, value)).length !== 1
  )
    return false;
  if (schema.allOf && !schema.allOf.every((child) => matches(child, value)))
    return false;
  if (schema.if) {
    const branch = matches(schema.if, value) ? schema.then : schema.else;
    if (branch && !matches(branch, value)) return false;
  }
  return true;
}

for (const schema of [inputSchema, auditSchema, resultSchema])
  assertSupportedSchema(schema);

/** @param {string} text @returns {import('./contracts.mjs').HookInput|null} */
export function parseInput(text) {
  /** @type {unknown} */ let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!matches(inputSchema, value) || !object(value)) return null;
  return /** @type {import('./contracts.mjs').HookInput} */ (
    Object.fromEntries(
      Object.entries(value).filter(([key]) =>
        Object.hasOwn(inputSchema.properties, key),
      ),
    )
  );
}

/** @param {unknown} value @returns {value is import('./contracts.mjs').AuditEvent} */
export function isAuditEvent(value) {
  return matches(auditSchema, value);
}

/** @param {unknown} value @returns {value is import('./contracts.mjs').HookResult} */
export function isHookResult(value) {
  return matches(resultSchema, value);
}
