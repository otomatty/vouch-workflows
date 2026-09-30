import { dated, digest, layers, read, updated } from "./knowledge.mjs";
import { isKnowledgeIndex } from "./validation.mjs";
/** @typedef {import("./knowledge.mjs").Context} Context
 * @typedef {import("./knowledge.mjs").Index} Index */
/** @param {Context} ctx @param {string|null} head @returns {Promise<{index:Index|null,errors:string[]}>} */
export async function inspectKnowledge(ctx, head) {
  /** @type {string[]} */ const errors = [];
  /** @type {Index} */ let index;
  try {
    index = JSON.parse(await read("vouch/knowledge/index.json", ctx));
    if (!isKnowledgeIndex(index)) throw new Error("invalid knowledge index");
    const seen = new Set();
    for (const entry of index.entries) {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        seen.has(entry.path) ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !dated(entry.updated, ctx)
      )
        throw new Error("invalid knowledge entry");
      seen.add(entry.path);
    }
    for (const layer of layers)
      if (
        !index.entries.some((e) =>
          e.path.startsWith(`vouch/knowledge/${layer}/`),
        )
      )
        throw new Error(`missing layer: ${layer}`);
    if (!seen.has("vouch/rules.md")) throw new Error("missing layer: rules");
    if (
      index.entries.some(
        (e) =>
          e.path !== "vouch/rules.md" &&
          !layers.some((l) => e.path.startsWith(`vouch/knowledge/${l}/`)),
      )
    )
      throw new Error("invalid layer path");
  } catch (error) {
    return { index: null, errors: [String(error)] };
  }
  if (!head || head !== index.generation)
    errors.push(`stale generation: ${index.generation} vs ${head}`);
  for (const entry of index.entries) {
    try {
      const text = await read(entry.path, ctx);
      if (digest(text) !== entry.sha256 || updated(text) !== entry.updated)
        errors.push(`stale document: ${entry.path}`);
    } catch (error) {
      errors.push(String(error));
    }
  }
  return { index, errors };
}
