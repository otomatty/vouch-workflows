import { dated, digest, links, read, section, updated } from "./knowledge.mjs";

/** @typedef {import("./knowledge.mjs").Context} Context
 * @typedef {import("./knowledge.mjs").Index} Index */
/** @param {string} target @param {Context} ctx @param {string|null} head @param {Index|null} index */
async function reference(target, ctx, head, index) {
  if (target.startsWith("https://")) {
    const url = new URL(target);
    if (!url.hash || url.username || url.password)
      throw new Error("URL section required");
    const receipt = JSON.parse(
      await read("vouch/knowledge/external.json", ctx),
    );
    const matches =
      receipt.version === 1 && Array.isArray(receipt.records)
        ? receipt.records.filter(
            (/** @type {{url:string}} */ r) => r?.url === target,
          )
        : [];
    if (matches.length !== 1)
      throw new Error(`missing external receipt: ${target}`);
    const row = matches[0];
    const newest =
      index?.entries
        .map((e) => e.updated)
        .sort()
        .at(-1) ?? ctx.now().slice(0, 10);
    if (
      !dated(row.checked, ctx) ||
      row.checked < newest ||
      typeof row.snapshot !== "string" ||
      digest(await read(row.snapshot, ctx)) !== row.sha256
    )
      throw new Error(`stale external receipt: ${target}`);
    return;
  }
  const code = /^(.+):([1-9]\d*)@([a-f0-9]{40}|[a-f0-9]{64})$/.exec(target);
  const doc = /^(.+)#([A-Za-z0-9_-]+)@(\d{4}-\d{2}-\d{2})$/.exec(target);
  if (!code && !doc) throw new Error(`invalid reference: ${target}`);
  const [, path = "", anchor = "", generation = ""] =
    code ?? /** @type {RegExpExecArray} */ (doc);
  const text = await read(path, ctx);
  if (code) {
    const count = text.split("\n").length - Number(text.endsWith("\n"));
    if (generation !== head || Number(anchor) > count)
      throw new Error(`stale code reference: ${target}`);
  } else if (
    !dated(generation, ctx) ||
    updated(text) !== generation ||
    !(
      text.includes(`<!-- sec:${anchor} -->`) || text.includes(`id="${anchor}"`)
    )
  )
    throw new Error(`stale document reference: ${target}`);
}
/** @param {string} text @param {Context} ctx @param {string|null} head @param {Index|null} index @param {boolean} [inline] */
export async function inspectReferences(
  text,
  ctx,
  head,
  index,
  inline = false,
) {
  const targets = links(inline ? text : section(text, "sec:references"));
  const errors = targets.length ? [] : ["missing references"];
  for (const target of targets) {
    try {
      await reference(target, ctx, head, index);
    } catch (error) {
      errors.push(String(error));
    }
  }
  return errors;
}
