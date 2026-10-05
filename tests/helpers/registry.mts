import { readdirSync, readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";

export function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Immutable schema snapshot for this test process, never a cache of input verdicts. */
let ajv: Ajv2020 | undefined;

export function validator(name: string) {
  if (!ajv) {
    const prepared = new Ajv2020({ strict: true, allErrors: true });
    for (const file of readdirSync("core/registry").filter((f) =>
      f.endsWith(".schema.json"),
    )) {
      prepared.addSchema(readJson(`core/registry/${file}`));
    }
    ajv = prepared;
  }
  const validate = ajv.getSchema(`https://vouch.dev/schemas/${name}.json`);
  if (!validate) throw new Error(`REG-1: missing schema ${name}`);
  return validate;
}

export function enforcementErrors(text: string, tags: Set<string>) {
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

export function isContractFixture(
  fixture: import("../../core/hooks/lib/contracts.mjs").HarnessFixture,
) {
  return (
    !fixture.synthetic &&
    fixture.provenance !== "synthetic" &&
    typeof fixture.version === "string" &&
    fixture.version.trim().length > 0
  );
}
