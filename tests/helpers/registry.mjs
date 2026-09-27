import { readdirSync, readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";

/** @param {string} path */
export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {string} name */
export function validator(name) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const file of readdirSync("core/registry").filter((f) =>
    f.endsWith(".schema.json"),
  )) {
    ajv.addSchema(readJson(`core/registry/${file}`));
  }
  const validate = ajv.getSchema(`https://vouch.dev/schemas/${name}.json`);
  if (!validate) throw new Error(`REG-1: missing schema ${name}`);
  return validate;
}

/** @param {string} text @param {Set<string>} tags */
export function enforcementErrors(text, tags) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!/\b(?:MUST|NEVER)\b|必ず|禁止/.test(line)) return [];
    const found = [...line.matchAll(/\[(R-[A-Z]+-\d+)\]/g)].map(
      (match) => match[1],
    );
    return found.length > 0 && found.every((tag) => tag && tags.has(tag))
      ? []
      : [`REG-4: line ${index + 1} has an unregistered requirement`];
  });
}

/** @param {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} fixture */
export function isContractFixture(fixture) {
  return (
    !fixture.synthetic &&
    fixture.provenance !== "synthetic" &&
    typeof fixture.version === "string" &&
    fixture.version.trim().length > 0
  );
}
