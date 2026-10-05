import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  enforcementErrors,
  readJson,
  validator,
} from "../helpers/registry.mjs";

test("strong requirements in product Markdown reference registered enforcement tags", (t) => {
  const tags = new Set(
    Object.keys(readJson("core/registry/enforcement-map.json").rules),
  );
  const files = ["core/skills", "core/agents", "core/templates"].flatMap(
    (dir) =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => `${e.parentPath}/${e.name}`),
  );
  if (existsSync("core/AGENTS.md")) files.push("core/AGENTS.md");
  t.plan(1);
  t.assert.deepEqual(
    files.flatMap((file) =>
      enforcementErrors(readFileSync(file, "utf8"), tags).map(
        (error) => `${file}: ${error}`,
      ),
    ),
    [],
    "REG-4",
  );
});

test("enforcement scanner rejects missing or unknown tags in both languages", (t) => {
  const tags = new Set(["R-HOOK-1"]);
  t.plan(5);
  t.assert.deepEqual(
    enforcementErrors("MUST use node [R-HOOK-1]", tags),
    [],
    "REG-4",
  );
  t.assert.equal(enforcementErrors("MUST use node", tags).length, 1, "REG-4");
  t.assert.equal(
    enforcementErrors("必ず記録する [R-UNKNOWN-1]", tags).length,
    1,
    "REG-4",
  );
  t.assert.equal(
    enforcementErrors("禁止する [R-HOOK-1] [R-UNKNOWN-1]", tags).length,
    1,
    "REG-4",
  );
  t.assert.deepEqual(
    enforcementErrors("Ordinary explanatory text", tags),
    [],
    "REG-4",
  );
});

test("frontmatter schemas require declared skill and agent interfaces", (t) => {
  const skill = validator("skill-frontmatter");
  const agent = validator("agent-frontmatter");
  t.plan(6);
  t.assert.equal(
    skill({
      name: "vouch-intent",
      description: "Intent",
      reads: "on-demand",
      "user-invocable": true,
    }),
    true,
    "DOC-1: skill",
  );
  t.assert.equal(
    skill({ name: "vouch-intent", description: "Intent" }),
    false,
    "DOC-1: reads required",
  );
  t.assert.equal(
    skill({
      name: "vouch",
      description: "Workflow",
      reads: true,
      "user-invocable": true,
    }),
    false,
    "DOC-1: reads enum",
  );
  t.assert.equal(
    agent({
      name: "vouch-builder",
      inputs: ["intent.md"],
      tools: ["Read"],
      disallowed: ["network"],
    }),
    true,
    "DOC-1: agent",
  );
  t.assert.equal(
    agent({ name: "vouch-builder", inputs: [], tools: [] }),
    false,
    "DOC-1: disallowed required",
  );
  t.assert.equal(
    agent({ name: "vouch-unknown", inputs: [], tools: [], disallowed: [] }),
    false,
    "DOC-1: three agents",
  );
});
