import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { runMigrate } from "../../../core/hooks/lib/migrate.mjs";
import { renderBrief } from "../../../core/hooks/lib/migrate-brief.mjs";
import { assertGolden } from "../../helpers/golden.mjs";
import {
  environment,
  git,
  ports,
  v2Files,
  where,
  writeTree,
} from "../../helpers/migrate.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

/** @param {import('node:test').TestContext} t */
async function planned(t) {
  const box = await sandbox(t, { git: false });
  await writeTree(box.root, v2Files());
  const report = await runMigrate(
    await createFileStore(box.root),
    environment,
    git,
    ports("plan", ...where),
  );
  if (!report.migration) throw new Error("plan failed");
  return report.migration;
}

test("the Japanese and English migration reports render completely and deterministically", async (t) => {
  const payload = await planned(t);
  const ja = renderBrief(payload);
  const en = renderBrief({ ...payload, language: "en" });
  t.plan(3);
  await assertGolden(t, "migration-ja.md", ja);
  await assertGolden(t, "migration-en.md", en);
  t.assert.equal(renderBrief(structuredClone(payload)), ja);
});

test("the report lists every source file once and every file without a destination with its reason", async (t) => {
  const payload = await planned(t);
  const brief = renderBrief(payload);
  const table =
    brief.split("<!-- sec:files -->")[1]?.split("<!-- sec:")[0] ?? "";
  const unmapped =
    brief.split("<!-- sec:unmapped -->")[1]?.split("<!-- sec:")[0] ?? "";
  t.plan(4);
  t.assert.equal(
    payload.files.every(
      (file) => table.split(`| \`${file.path}\` |`).length === 2,
    ),
    true,
  );
  t.assert.equal(
    (table.match(/^\| `aidlc\//gm) ?? []).length,
    payload.files.length,
  );
  t.assert.equal(
    (unmapped.match(/^\| `aidlc\//gm) ?? []).length,
    payload.files.filter((file) => file.to.length === 0).length,
  );
  t.assert.equal(
    renderBrief({
      ...payload,
      writes: { archived: 1, unchanged: 0, audit: "none", brief: "written" },
      brief: { path: "x", sha256: "a".repeat(64) },
      artifacts: [],
    }),
    brief,
    "writes, the current digest and the artifacts never change the report",
  );
});

test("untrusted text cannot break the report tables", async (t) => {
  const payload = await planned(t);
  const brief = renderBrief({
    ...payload,
    decisions: [
      {
        id: "evt_x",
        name: "GATE_APPROVED",
        ts: "2025-06-15T12:00:00Z",
        source_path: "a|b`c\nd.md#L1",
      },
    ],
    codekb: [
      {
        repo: "r",
        files: 1,
        scanned: "x|y",
        commit: "`z`\n",
        verifiable: false,
      },
    ],
  });
  t.plan(2);
  t.assert.match(
    brief,
    /\| evt_x \| GATE_APPROVED \| 2025-06-15T12:00:00Z \| `a\\\|b'c d\.md#L1` \|/,
  );
  t.assert.match(brief, /\| r \| 1 \| x\\\|y \| 'z' \|/);
});

test("empty sections say none, and affirmation and a full SHA are shown as found", async (t) => {
  const payload = await planned(t);
  const brief = renderBrief({
    ...payload,
    language: "en",
    files: [],
    units: [],
    decisions: [],
    affirmation:
      "aidlc-state.md: Practices Affirmed Timestamp 2025-08-20T09:30:00Z",
    audit: { blocks: 0, converted: 0, legacy: 0, estimated: 0, types: [] },
    codekb: [
      {
        repo: "api",
        files: 2,
        scanned: null,
        commit: "a".repeat(40),
        verifiable: true,
      },
    ],
  });
  t.plan(4);
  t.assert.match(brief, /^files: 0$/m);
  t.assert.match(
    brief,
    /<!-- sec:unmapped -->\n## 4\. Files without a destination\n\nnone\n/,
  );
  t.assert.match(
    brief,
    /^Rules affirmation evidence: aidlc-state\.md: Practices Affirmed Timestamp 2025-08-20T09:30:00Z$/m,
  );
  t.assert.match(brief, /^\| api \| 2 \| none \| a{40} \| full SHA \|$/m);
});
