import migration from "../../registry/migration.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};

// Source file → destinations (docs/development/migrate.md). Pure: the registry rules decide, never the content's meaning.
/** @typedef {{match:string,to:string[],note?:string,final?:true,contains?:string,affirmed?:true}} Rule */

const rules = {
  record: /** @type {Rule[]} */ (migration.record),
  space: /** @type {Rule[]} */ (migration.space),
};
// A codekb repo exactly as the space routing rule names it, so the report never lists one it archives only.
const codekbRepo = new RegExp(
  rules.space.find((rule) => rule.to.some((to) => to.includes("$1")))?.match ??
    "(?!)",
);

/**
 * Every matching rule adds its destinations until a final one; `contains` tests the lines of the text,
 * `affirmed` needs affirmation evidence. An empty result carries why.
 * @param {'record'|'space'} scope @param {string} origin @param {string|null} text @param {boolean} affirmed
 * @returns {{to:string[],note?:string}}
 */
export function routeFile(scope, origin, text, affirmed) {
  /** @type {string[]} */ const to = [];
  let unaffirmed = false;
  for (const rule of rules[scope]) {
    const match = new RegExp(rule.match).exec(origin);
    if (!match) continue;
    if (
      rule.contains !== undefined &&
      !(text !== null && new RegExp(rule.contains, "m").test(text))
    )
      continue;
    if (rule.affirmed && !affirmed) {
      unaffirmed = true;
      continue;
    }
    for (const destination of rule.to) {
      const resolved = destination.replace("$1", match[1] ?? "");
      if (!to.includes(resolved)) to.push(resolved);
    }
    if (rule.final) return rule.note ? { to, note: rule.note } : { to };
  }
  if (to.length) return { to };
  return { to, note: unaffirmed ? "unaffirmed" : "unmatched" };
}

/** The Intent documents named by the destinations, plus the required ones, in workflow order.
 * @param {string[][]} destinations @returns {string[]} */
export function expectedArtifacts(destinations) {
  const named = new Set([
    ...migration.artifacts.required,
    ...destinations.flat().map((destination) => destination.split("#")[0]),
  ]);
  return [...Object.values(documents.artifacts), documents.decisions].filter(
    (name) => named.has(name),
  );
}

/**
 * codekb repos with their file count and the scan record's date and commit, as written.
 * Only a full SHA can be compared with Git; anything else needs a rescan.
 * @param {[string,string|null][]} entries Space-relative origins and their UTF-8 text.
 * @returns {import('./migration-contracts.mjs').CodekbObservation[]}
 */
export function readCodekb(entries) {
  /** @type {Map<string,import('./migration-contracts.mjs').CodekbObservation>} */
  const repos = new Map();
  for (const [origin, text] of entries) {
    const repo = codekbRepo.exec(origin)?.[1];
    if (!repo) continue;
    const entry = repos.get(repo) ?? {
      repo,
      files: 0,
      scanned: null,
      commit: null,
      verifiable: false,
    };
    entry.files++;
    if (origin === `codekb/${repo}/${migration.codekb.timestamp}` && text) {
      entry.scanned = /^- Date:[ \t]*(.+?)[ \t]*\r?$/m.exec(text)?.[1] ?? null;
      entry.commit = /^- Commit:[ \t]*(.+?)[ \t]*\r?$/m.exec(text)?.[1] ?? null;
      entry.verifiable = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(
        entry.commit ?? "",
      );
    }
    repos.set(repo, entry);
  }
  return [...repos.values()].sort((a, b) => (a.repo < b.repo ? -1 : 1));
}
