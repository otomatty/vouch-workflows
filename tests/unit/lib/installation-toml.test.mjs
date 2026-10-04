import { test } from "node:test";
import { restoreOwned } from "../../../core/hooks/lib/installation-ownership.mjs";
import {
  enableCodex,
  removeCodex,
} from "../../../core/hooks/lib/installation-toml.mjs";

const owned = { path: "owned", kind: "toml", content: "", previous: null };

test("Codex cannot redefine an array of feature or agent tables as a normal table", (t) => {
  for (const section of ["features", "agents"])
    for (const name of [section, `"${section}"`, `'${section}'`]) {
      const text = `[[ ${name} ]] # existing array table\ncustom = true\n`;
      t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
    }
});

test("Codex rejects multiline nested arrays before creating duplicate keys and preserves inline arrays", (t) => {
  for (const text of [
    "[features]\nflags = [\n  [true, false],\n]\nhooks = false\n",
    "[agents]\nflags = [ # nested values\n  [true, false],\n]\nmax_depth = 3\n",
  ]) {
    t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
    t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
  }
  for (const text of [
    "[features]\nflags = [[true, false], [false, true]] # [ ignored\nhooks = true\n[agents]\nmax_depth = 3\n",
    'name = "[ = # ]"\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n',
  ])
    t.assert.equal(enableCodex(text).text, text);
});

test("Codex TOML rejects settings disguised inside multiline strings and keeps ordinary quoted strings", (t) => {
  for (const quote of ['"""', "'''"]) {
    const text = `developer_instructions = ${quote}\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n${quote}\n`;
    t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
    t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
  }
  for (const text of [
    `name = "''' is ordinary"\n`,
    `name = '""" is ordinary'\n`,
    `name = "escaped \\" and '''"\n`,
    `# """ is a comment\n`,
    `# ''' is a trailing comment`,
  ])
    t.assert.equal(enableCodex(text).text.startsWith(text), true);
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
