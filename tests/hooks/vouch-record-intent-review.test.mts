import { mkdir, symlink, unlink } from "node:fs/promises";
import { assertGolden } from "../helpers/golden.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import {
  artifact,
  audit,
  draft,
  intent,
  reviewBox,
} from "../helpers/intent-review.mjs";
import { validator } from "../helpers/registry.mjs";
import { runHook, sessionFor } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex"] as const) {
  test(`${harness} records explicit gate and approval without changing the draft`, async (t) => {
    const box = await reviewBox(t, harness);
    const opened = box.submit("vouch review");
    const [gate] = await box.rows();
    if (!gate) throw Error("no gate");
    const approved = box.submit(
      `vouch approve ${gate.id}`,
      "synthetic-approval",
      "2026-09-27T00:00:02.125Z",
    );
    const rows = await box.rows();
    const validate = validator("audit-event");
    t.plan(11);
    t.assert.equal(opened.exitCode, 2);
    t.assert.match(opened.stderr, /VOUCH-REVIEW-RECORDED/);
    t.assert.equal(approved.exitCode, 2);
    t.assert.match(approved.stderr, /VOUCH-APPROVAL-RECORDED/);
    t.assert.deepEqual([opened.stdout, approved.stdout], ["", ""]);
    t.assert.equal(rows.length, 2);
    t.assert.deepEqual(
      rows.map((row) => row.type),
      ["gate.opened", "intent.approved"],
    );
    t.assert.equal(
      rows.every((value) => validate(value)),
      true,
    );
    t.assert.equal(rows[1]?.wait_ms, 2125);
    t.assert.equal(await box.read(artifact), draft);
    await assertGolden(
      t,
      `${harness}-intent-review.jsonl`,
      await box.read(audit),
    );
  });
  test(`${harness} review replays retain timestamps and separate distinct submissions`, async (t) => {
    const box = await reviewBox(t, harness);
    box.submit("vouch review");
    const [gate] = await box.rows();
    if (!gate) throw Error("no gate");
    const prompt = `vouch approve ${gate.id}`;
    box.submit(prompt, "synthetic-approval", "2026-09-27T00:00:02Z");
    const first = await box.read(audit);
    const open = box.submit(
      "vouch review",
      "synthetic-open",
      "2026-09-28T00:00:00Z",
    );
    const approve = box.submit(
      prompt,
      "synthetic-approval",
      "2026-09-28T00:00:00Z",
    );
    t.plan(5);
    t.assert.equal(open.exitCode, 2);
    t.assert.equal(approve.exitCode, 2);
    t.assert.equal(await box.read(audit), first);
    box.submit("vouch review", "synthetic-second");
    t.assert.equal((await box.rows()).length, 3);
    t.assert.notEqual((await box.rows())[2]?.id, gate.id);
  });
}

test("unrelated and unscoped events do not read or create review state", async (t) => {
  const box = await reviewBox(t);
  const options = { root: box.root, intent };
  const results = [
    box.submit("yes"),
    runHook("vouch-record-intent-review", box.fixture("vouch review"), {
      root: box.root,
    }),
    runHook("vouch-record-intent-review", sessionFor(box.root), options),
  ];
  t.plan(4);
  for (const result of results)
    t.assert.deepEqual(
      [result.exitCode, result.stdout, result.stderr],
      [0, "", ""],
    );
  await t.assert.rejects(box.read(audit), { code: "ENOENT" });
});

test("malformed commands and missing identity cannot manufacture a review", async (t) => {
  const box = await reviewBox(t);
  const fixture = box.fixture("vouch review");
  Reflect.deleteProperty(fixture.payload, "prompt_id");
  const results = [
    box.submit("vouch review\n"),
    box.submit("vouch approve nope"),
    runHook("vouch-record-intent-review", fixture, { root: box.root, intent }),
  ];
  t.plan(4);
  for (const result of results)
    t.assert.equal(result.exitCode, 2, result.stderr);
  await t.assert.rejects(box.read(audit), { code: "ENOENT" });
});

test("missing unsupported and already approved artifacts cannot open a gate", async (t) => {
  const box = await reviewBox(t);
  t.plan(4);
  for (const text of [
    "",
    draft.replace("draft", "approved"),
    "unknown format",
  ]) {
    await box.write(artifact, text);
    t.assert.equal(box.submit("vouch review").exitCode, 2);
  }
  await t.assert.rejects(box.read(audit), { code: "ENOENT" });
});

test("approval rejects stale and missing gates and accepts an explicit resumed session", async (t) => {
  const box = await reviewBox(t);
  box.submit("vouch review");
  const before = await box.read(audit);
  const [gate] = await box.rows();
  if (!gate) throw Error("no gate");
  t.plan(6);
  t.assert.equal(
    box.submit(`vouch approve evt_${"0".repeat(64)}`, "answer").exitCode,
    2,
  );
  await box.write(artifact, `${draft}changed`);
  t.assert.match(
    box.submit(`vouch approve ${gate.id}`, "answer").stderr,
    /VOUCH-REVIEW-EVIDENCE/,
  );
  t.assert.equal(await box.read(audit), before);
  await box.write(artifact, draft);
  const fixture = box.fixture(`vouch approve ${gate.id}`, "resumed-answer");
  fixture.payload.session_id = "synthetic-resumed";
  const result = runHook("vouch-record-intent-review", fixture, {
    root: box.root,
    intent,
    instant: "2026-09-27T00:00:04Z",
  });
  t.assert.match(result.stderr, /VOUCH-APPROVAL-RECORDED/);
  t.assert.equal((await box.rows())[1]?.session, "synthetic-resumed");
  t.assert.equal((await box.rows())[1]?.wait_ms, 4000);
});

test("synthetic historical foreign and mistimed gates cannot authorize records", async (t) => {
  const box = await reviewBox(t);
  box.submit("vouch review");
  const [gate] = await box.rows();
  if (!gate) throw Error("no gate");
  const historical = { ...gate };
  Reflect.deleteProperty(historical, "revision");
  const variants = [
    { ...gate, synthetic: true },
    historical,
    { ...gate, intent: "other" },
    { ...gate, harness: "codex" },
    { ...gate, ts: "2026-09-28T00:00:00Z" },
    { ...gate, ts: "2026-02-30T00:00:00Z" },
  ];
  t.plan(variants.length * 2);
  for (const candidate of variants) {
    const before = `${JSON.stringify(candidate)}\n`;
    await box.write(audit, before);
    const result = box.submit(`vouch approve ${gate.id}`, "answer");
    t.assert.doesNotMatch(result.stderr, /VOUCH-APPROVAL-RECORDED/);
    t.assert.equal(await box.read(audit), before);
  }
});

test("rebinding a submission and corrupt logs never report success", async (t) => {
  const box = await reviewBox(t);
  box.submit("vouch review");
  const before = await box.read(audit);
  await box.write(artifact, `${draft}changed`);
  const conflict = box.submit("vouch review");
  t.plan(6);
  t.assert.equal(conflict.exitCode, 0);
  t.assert.match(conflict.stderr, /AUDIT-CONFLICT/);
  t.assert.equal(await box.read(audit), before);
  await box.write(audit, "broken\n");
  const corrupt = box.submit("vouch review");
  t.assert.equal(corrupt.exitCode, 0);
  t.assert.match(corrupt.stderr, /AUDIT-CORRUPT/);
  t.assert.equal(await box.read(audit), "broken\n");
});

test("artifact links and unsafe configured scope cannot emit review events", async (t) => {
  const box = await reviewBox(t);
  await box.write("outside/intent.md", draft);
  await symlink(
    box.path("outside"),
    box.path("vouch/intents/linked-intent"),
    "junction",
  );
  const fixture = box.fixture("vouch review");
  const bad = runHook("vouch-record-intent-review", fixture, {
    root: box.root,
    intent: "../escape",
  });
  const linked = runHook("vouch-record-intent-review", fixture, {
    root: box.root,
    intent: "linked-intent",
  });
  t.plan(5);
  t.assert.equal(linked.exitCode, 0);
  t.assert.doesNotMatch(linked.stderr, /VOUCH-REVIEW-RECORDED/);
  t.assert.equal(bad.exitCode, 0);
  t.assert.match(bad.stderr, /AUDIT-SCOPE/);
  await t.assert.rejects(box.read(audit), { code: "ENOENT" });
});

test("missing artifact and occupied audit lock never report recorded approval", async (t) => {
  const box = await reviewBox(t);
  await unlink(box.path(artifact));
  const missing = box.submit("vouch review");
  await box.write(artifact, draft);
  box.submit("vouch review");
  const before = await box.read(audit);
  const [gate] = await box.rows();
  if (!gate) throw Error("gate");
  await mkdir(box.path(`${audit}.vouch-lock`));
  const locked = box.submit(`vouch approve ${gate.id}`, "approval");
  t.plan(5);
  t.assert.equal(missing.exitCode, 2);
  t.assert.match(missing.stderr, /VOUCH-REVIEW-DRAFT/);
  t.assert.equal(locked.exitCode, 0);
  t.assert.doesNotMatch(locked.stderr, /VOUCH-APPROVAL-RECORDED/);
  t.assert.equal(await box.read(audit), before);
});

test("approval replay cannot move an input to a different gate or reuse synthetic history", async (t) => {
  const box = await reviewBox(t);
  box.submit("vouch review");
  box.submit("vouch review", "second-open");
  const [first, second] = await box.rows();
  if (!first || !second) throw Error("gates");
  box.submit(`vouch approve ${first.id}`, "answer");
  const before = await box.read(audit);
  const conflict = box.submit(`vouch approve ${second.id}`, "answer");
  t.plan(5);
  t.assert.equal(conflict.exitCode, 0);
  t.assert.match(conflict.stderr, /AUDIT-CONFLICT/);
  t.assert.equal(await box.read(audit), before);
  const rows = await box.rows();
  await box.write(
    audit,
    rows
      .map(
        (row) =>
          `${JSON.stringify(
            row.type === "intent.approved" ? { ...row, synthetic: true } : row,
          )}\n`,
      )
      .join(""),
  );
  const rejected = box.submit(`vouch approve ${first.id}`, "answer");
  t.assert.equal(rejected.exitCode, 2);
  t.assert.match(rejected.stderr, /synthetic/);
});

test("invalid process inputs cannot read or append review evidence", async (t) => {
  const box = await reviewBox(t);
  const fixture = box.fixture("vouch review");
  const cases = [
    "",
    "not json",
    JSON.stringify({ ...fixture.payload, session_id: undefined }),
    JSON.stringify({ ...fixture.payload, prompt: 123 }),
    JSON.stringify({ ...fixture.payload, cwd: box.path("../outside") }),
    " ".repeat(1024 * 1024),
  ];
  t.plan(cases.length * 3 + 1);
  for (const raw of cases) {
    const result = runHook("vouch-record-intent-review", fixture, {
      root: box.root,
      intent,
      raw,
    });
    t.assert.equal(result.exitCode, 0);
    t.assert.equal(result.stdout, "");
    t.assert.doesNotMatch(result.stderr, /VOUCH-(REVIEW|APPROVAL)-RECORDED/);
  }
  await t.assert.rejects(box.read(audit), { code: "ENOENT" });
});
