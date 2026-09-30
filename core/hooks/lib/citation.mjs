import { readGit } from "./git.mjs";
import {
  dated,
  digest,
  layers,
  links,
  read,
  section,
  updated,
} from "./knowledge.mjs";

/** @typedef {import("./knowledge.mjs").Context} Context
 * @typedef {import("./knowledge.mjs").Index} Index
 * @typedef {import('./runtime-contracts.mjs').GitPort} GitPort */
/** @param {string} target @param {Context} ctx @param {string|null} head @param {Index|null} index @param {GitPort} [suppliedGit] */
async function reference(target, ctx, head, index, suppliedGit) {
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
  const canonical = (await ctx.locate(path)).inside;
  if (canonical === null) throw new Error(`boundary: ${path}`);
  if (
    canonical === "vouch/rules.md" ||
    layers.some((layer) => canonical.startsWith(`vouch/knowledge/${layer}/`))
  ) {
    const entry = index?.entries.find((entry) => entry.path === canonical);
    if (!entry) throw new Error(`unindexed knowledge reference: ${target}`);
    if (digest(text) !== entry.sha256 || updated(text) !== entry.updated)
      throw new Error(`stale knowledge reference: ${target}`);
  }
  if (code) {
    if (generation !== head) throw new Error(`stale code reference: ${target}`);
    const git = suppliedGit ?? readGit(ctx.projectRoot);
    const tree = await git(
      "ls-tree",
      "-z",
      "--full-tree",
      generation,
      "--",
      `:(literal)${canonical}`,
    );
    if (
      !tree ||
      !/^100(?:644|755) blob (?:[a-f0-9]{40}|[a-f0-9]{64})\t/.test(tree) ||
      !tree.endsWith(`\t${canonical}\0`) ||
      tree.split("\0").length !== 2
    )
      throw new Error(`missing committed code: ${target}`);
    const committed = await git("show", `${generation}:${canonical}`);
    if (committed === null)
      throw new Error(`missing committed code: ${target}`);
    const count =
      committed.split("\n").length - Number(committed.endsWith("\n"));
    if (Number(anchor) > count)
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
/** @param {string} text @param {Context} ctx @param {string|null} head @param {Index|null} index @param {boolean} [inline] @param {GitPort} [suppliedGit] */
export async function inspectReferences(
  text,
  ctx,
  head,
  index,
  inline = false,
  suppliedGit,
) {
  const targets = links(inline ? text : section(text, "sec:references"));
  const errors = targets.length ? [] : ["missing references"];
  for (const target of targets) {
    try {
      await reference(target, ctx, head, index, suppliedGit);
    } catch (error) {
      errors.push(String(error));
    }
  }
  return errors;
}
