import { test } from "node:test";
import { restoreOwned } from "../../../core/hooks/lib/installation-ownership.mjs";
import { enableCodex } from "../../../core/hooks/lib/installation-toml.mjs";

const owned = {
  path: "owned",
  kind: "file",
  content: "installed",
  previous: null,
};

test("ownership requires valid metadata, exact file bytes and a unique documentation block", (t) => {
  t.assert.equal(restoreOwned("installed", owned), null);
  t.assert.equal(
    restoreOwned("installed", { ...owned, previous: "prior" }),
    "prior",
  );
  for (const value of [
    null,
    [],
    {},
    { ...owned, path: 1 },
    { ...owned, content: 1 },
    { ...owned, previous: 1 },
    { ...owned, kind: "unknown" },
  ])
    t.assert.throws(() => restoreOwned("installed", value), /INSTALL-STATE/);
  for (const text of [null, "changed"])
    t.assert.throws(() => restoreOwned(text, owned), /INSTALL-CONFLICT/);
  const block = {
    ...owned,
    kind: "block",
    content: "<managed>",
    previous: "prior",
  };
  t.assert.equal(restoreOwned("prior<managed>", block), "prior");
  t.assert.equal(restoreOwned("user edits<managed>", block), "user edits");
  t.assert.equal(restoreOwned("<managed>", { ...block, previous: null }), null);
  for (const text of [null, "missing", "<managed><managed>"])
    t.assert.throws(() => restoreOwned(text, block), /INSTALL-CONFLICT/);
});

test("hook ownership preserves unrelated settings and rejects changed, missing or duplicated registrations", (t) => {
  const hook = { command: "node launcher", args: ["one", "two"] };
  const contribution = {
    hooks: { start: [hook] },
    statusLine: { command: "owned" },
  };
  const entry = {
    ...owned,
    kind: "hooks",
    content: JSON.stringify(contribution),
  };
  const actual = {
    ...contribution,
    custom: true,
    hooks: { start: [hook, { command: "user" }] },
  };
  t.assert.deepEqual(
    JSON.parse(restoreOwned(JSON.stringify(actual), entry) ?? "null"),
    { custom: true, hooks: { start: [{ command: "user" }] } },
  );
  t.assert.equal(restoreOwned(JSON.stringify(contribution), entry), null);
  const prior = { hooks: { start: [] }, statusLine: { command: "prior" } };
  t.assert.equal(
    restoreOwned(JSON.stringify(contribution), {
      ...entry,
      previous: JSON.stringify(prior),
    }),
    JSON.stringify(prior),
  );
  for (const actual of [
    null,
    [],
    {},
    { hooks: { start: [hook] } },
    { ...contribution, hooks: { start: [hook, hook] } },
    { ...contribution, hooks: { start: [] } },
    { ...contribution, hooks: { start: [{ ...hook, args: ["two", "one"] }] } },
    { ...contribution, hooks: { start: {} } },
  ])
    t.assert.throws(
      () => restoreOwned(JSON.stringify(actual), entry),
      /INSTALL-(CONFIG|CONFLICT)/,
    );
  for (const content of [
    "null",
    "{}",
    JSON.stringify({ hooks: { start: {} } }),
  ])
    t.assert.throws(
      () => restoreOwned(JSON.stringify(contribution), { ...entry, content }),
      /INSTALL-(CONFIG|CONFLICT)/,
    );
});

test("Codex settings preserve existing positive depth and restore owned settings without overwriting unrelated edits", (t) => {
  const initial = enableCodex(null);
  t.assert.match(initial.text, /hooks = true/);
  t.assert.equal(
    restoreOwned(initial.text, {
      ...owned,
      kind: "toml",
      content: initial.content,
    }),
    null,
  );
  const before = "[features]\nhooks = false\n[agents]\nmax_depth = 0\n";
  const enabled = enableCodex(before);
  const entry = {
    ...owned,
    kind: "toml",
    content: enabled.content,
    previous: before,
  };
  t.assert.equal(restoreOwned(enabled.text, entry), before);
  t.assert.match(
    restoreOwned(`${enabled.text}custom = true\n`, entry) ?? "",
    /custom = true/,
  );
  const existing =
    '["features"]\n"hooks" = true # keep\n[\'agents\']\nmax_depth = 3\n';
  t.assert.equal(enableCodex(existing).content, "[]\n");
  t.assert.equal(enableCodex(existing).text, existing);
  t.assert.match(
    enableCodex("[features]\nuser = true\n[agents]\nuser = true\n").text,
    /user = true/,
  );
  for (const text of [
    "[features]\n[features]\n",
    "features.hooks = true\n",
    "[features]\nhooks = true\nhooks = false\n",
  ])
    t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
  for (const text of [
    null,
    "",
    enabled.text.replace("hooks = true", "hooks = false"),
  ])
    t.assert.throws(() => restoreOwned(text, entry), /INSTALL-CONFLICT/);
});
