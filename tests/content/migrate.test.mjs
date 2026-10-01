import { readFileSync } from "node:fs";
import { test } from "node:test";
import commands from "../../core/registry/intent-review.json" with {
  type: "json",
};
import migration from "../../core/registry/migration.json" with {
  type: "json",
};

const reference = readFileSync(
  "core/skills/vouch/references/migrate.md",
  "utf8",
);
const orchestrator = readFileSync("core/skills/vouch/SKILL.md", "utf8");

test("migrate names the registered command per operation and leaves approval to the person's input", (t) => {
  t.plan(migration.operations.length + 6);
  for (const operation of migration.operations)
    t.assert.equal(
      reference.includes(
        `node "{{HARNESS_DIR}}/hooks/vouch-migrate.mjs" ${operation} <space> <YYMMDD-label>`,
      ),
      true,
      operation,
    );
  t.assert.equal(
    reference.includes(`\`${commands.migrateApprovePrefix}<`),
    true,
  );
  t.assert.match(reference, /status: draft/);
  t.assert.match(reference, /\[R-PROJECT-1\]/);
  t.assert.match(reference, /\[R-PROJECT-3\]/);
  t.assert.match(reference, /vouch knowledge check/);
  t.assert.match(orchestrator, /\/vouch migrate/);
});
