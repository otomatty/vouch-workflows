import { test } from "node:test";
import { isAuditEvent } from "../../../core/hooks/lib/validation.mjs";
import { planned } from "../../helpers/intent-review.mjs";
import {
  auditPath,
  command,
  environment,
  home,
  ids,
  plan,
  project,
  rows,
} from "../../helpers/lifecycle.mjs";

test("the command requires an Intent id and a known operation", async (t) => {
  const files = project({ "intent.md": plan });
  const reports = [
    await command(files, ["intent-created"], { intent: null }),
    await command(files, ["intent-created"], { intent: "../outside" }),
    await command(files, []),
    await command(files, ["not-a-record"]),
  ];
  t.plan(2);
  t.assert.deepEqual(reports.map(ids), [
    ["LIFECYCLE-SCOPE"],
    ["LIFECYCLE-SCOPE"],
    ["LIFECYCLE-ARGS"],
    ["LIFECYCLE-ARGS"],
  ]);
  t.assert.equal(files.data.has(auditPath), false);
});

test("intent-created reads the plan risk and replays without rewriting", async (t) => {
  const files = project({ "intent.md": plan });
  const created = await command(files, ["intent-created"]);
  const again = await command(files, ["intent-created"], {
    now: "2026-10-01T00:00:00.000Z",
  });
  const before = files.data.get(auditPath);
  files.data.set(
    `${home}/intent.md`,
    planned([["U1", "H: contract", "required: contract"]]),
  );
  const conflict = await command(files, ["intent-created"]);
  const bare = project({});
  const missing = await command(bare, ["intent-created"]);
  const extra = await command(files, ["intent-created", "U1"]);
  const codex = project({ "intent.md": plan });
  await command(codex, ["intent-created"], {
    environment: { ...environment, installationRoot: ".codex" },
  });
  const plain = project({ "intent.md": plan });
  await command(plain, ["intent-created"], {
    environment: { ...environment, installationRoot: "core" },
    clock: false,
  });
  const record = rows(files)[0];
  t.plan(9);
  t.assert.deepEqual(
    [created.ok, again.ok, conflict.ok, missing.ok, extra.ok],
    [true, true, false, false, false],
  );
  t.assert.deepEqual(
    [ids(again)[0], ids(conflict)[0], ids(missing)[0], ids(extra)[0]],
    [
      "LIFECYCLE-RECORDED",
      "LIFECYCLE-CONFLICT",
      "LIFECYCLE-PLAN",
      "LIFECYCLE-ARGS",
    ],
  );
  t.assert.match(again.checks[0]?.detail ?? "", /duplicate/);
  t.assert.equal(files.data.get(auditPath), before);
  t.assert.equal(record.risk, "M");
  t.assert.equal(record.type, "intent.created");
  t.assert.equal(isAuditEvent(record), true);
  t.assert.equal(rows(codex)[0].harness, "codex");
  t.assert.equal(rows(plain)[0].harness, undefined);
});
