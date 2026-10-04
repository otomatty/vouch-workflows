import { test } from "node:test";
import { restoreOwned } from "../../../core/hooks/lib/installation-ownership.mjs";
import {
  enableCodex,
  removeCodex,
} from "../../../core/hooks/lib/installation-toml.mjs";

const owned = { path: "owned", kind: "toml", content: "", previous: null };

test("Codex requires separators between array elements and inline assignments", (t) => {
  for (const value of [
    "[1 2]",
    "{ a = 1 b = 2 }",
    '["a" "b"]',
    "[[] []]",
    "{ a = [1] b = {} }",
    "{ a = 1, }",
    "[1,,2]",
    "{ a = 1,, b = 2 }",
  ])
    for (const prefix of [
      "",
      "[features]\nhooks = true\n[agents]\nmax_depth = 3\n",
    ]) {
      const text = `${prefix}bad = ${value} # trailing`;
      t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
      t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
    }
  for (const value of [
    "[1, 2,]",
    '[[], {}, "a , b"]',
    '{ a = [1, 2], b = { c = "a = b, c" } }',
    "1979-05-27 07:32:00Z",
  ]) {
    const text = `[features]\nhooks = true\n[agents]\nmax_depth = 3\nvalid = ${value}\n`;
    t.assert.equal(enableCodex(text).text, text);
    t.assert.equal(removeCodex(text, "[]", null), text);
  }
});

test("Codex rejects assignments without values before enabling or restoring settings", (t) => {
  for (const prefix of [
    "",
    "[features]\nhooks = true\n[agents]\nmax_depth = 3\n",
  ])
    for (const invalid of [
      "bad =",
      "bad = \t\r\n",
      "bad = # trailing",
      "bad = # trailing\nnext = 1\n",
      "bad =\nnext = 1\n",
      "x = { a = }",
      "x = { a =, b = 1 }",
      "bad = = 1",
    ]) {
      const text = prefix + invalid;
      t.assert.throws(
        () => enableCodex(text),
        /INSTALL-CONFIG:.*missing.*value/,
      );
      t.assert.throws(
        () => removeCodex(text, "[]", null),
        /INSTALL-CONFIG:.*missing.*value/,
      );
    }
  for (const valid of [
    'empty = ""',
    "empty = ''",
    "empty = []",
    "empty = {}",
    'x = { a = "", b = [], c = {} }',
    'x = "= # , ] }"',
  ]) {
    const text = `[features]\nhooks = true\n[agents]\nmax_depth = 3\n${valid} # trailing`;
    t.assert.equal(enableCodex(text).text, text);
    t.assert.equal(removeCodex(text, "[]", null), text);
  }
});

test("Codex refuses unfinished and mismatched inline tables before enabling or restoring settings", (t) => {
  for (const value of [
    "{ a = 1",
    "{ a = 1}}",
    "{ a = [1}, 2]",
    "[ { a = 1 ] }",
    "{ a = 1\n}",
  ])
    for (const suffix of ["", " # trailing"])
      for (const prefix of [
        "",
        "[features]\nhooks = true\n[agents]\nmax_depth = 3\n",
      ]) {
        const text = `${prefix}x = ${value}${suffix}`;
        t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
        t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
      }
  for (const value of [
    "{}",
    "{ a = 1, b = { c = [1, 2] } }",
    "[ { a = '}[', b = [1] } ]",
  ])
    for (const suffix of ["", " # trailing"]) {
      const text = `[features]\nhooks = true\n[agents]\nmax_depth = 3\nx = ${value}${suffix}`;
      t.assert.equal(enableCodex(text).text, text);
      t.assert.equal(removeCodex(text, "[]", null), text);
    }
});

test("Codex refuses unbalanced arrays at EOF before accepting or editing settings", (t) => {
  for (const text of [
    "x = [1, 2",
    "x = [[1], [2]",
    "x = 1]",
    "x = ] # trailing",
    "x = [1]] # trailing",
  ])
    for (const before of [
      text,
      `[features]\nhooks = true\n[agents]\nmax_depth = +3\n${text}`,
    ]) {
      t.assert.throws(() => enableCodex(before), /INSTALL-CONFIG:.*array/);
      t.assert.throws(
        () => removeCodex(before, "[]", null),
        /INSTALL-CONFIG:.*array/,
      );
    }
  const valid =
    "[features]\nhooks = true\n[agents]\nmax_depth = 3\nx = [1, [2]] # trailing";
  t.assert.equal(enableCodex(valid).text, valid);
  t.assert.equal(removeCodex(valid, "[]", null), valid);
});

test("Codex retains every positive TOML integer spelling and replaces nonpositive depths", (t) => {
  for (const value of [
    "+3",
    "1_000",
    "+1_000",
    "0xF_F",
    "0o7_7",
    "0b1_01",
    "9223372036854775807",
  ])
    for (const key of ["max_depth", '"max_depth"', "'max_depth'"]) {
      const before = `[features]\nhooks = true\n[agents]\n${key} = ${value} # retain exact bytes\n`;
      const enabled = enableCodex(before);
      t.assert.equal(enabled.text, before, value);
      t.assert.equal(enabled.content, "[]\n");
      t.assert.equal(removeCodex(before, enabled.content, before), before);
    }
  for (const value of ["0", "+0", "-0", "-1_000", "0x0", "0o0", "0b0"]) {
    const before = `[features]\nhooks = true\n[agents]\nmax_depth = ${value}\n`;
    const enabled = enableCodex(before);
    t.assert.match(enabled.text, /max_depth = 1\n/);
    t.assert.equal(removeCodex(enabled.text, enabled.content, before), before);
  }
});

test("Codex preserves unrelated table assignments named features or agents while refusing root collisions", (t) => {
  for (const before of [
    '[provider]\nfeatures = "local"\nagents = 3\n',
    '["provider"]\n"features".custom = true\n\'agents\' = "local"\n',
    '[[provider]]\nfeatures = "local"\nagents = 3\n',
  ]) {
    const enabled = enableCodex(before);
    t.assert.equal(enabled.text.startsWith(before), true);
    t.assert.match(enabled.text, /hooks = true/);
    t.assert.match(enabled.text, /max_depth = 1/);
    t.assert.equal(removeCodex(enabled.text, enabled.content, before), before);
  }
  for (const text of [
    'features = "local"\n[provider]\n',
    '"agents".custom = true\n[provider]\n',
  ])
    t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
});

test("Codex refuses escaped basic key and table names but preserves value escapes and literal names", (t) => {
  for (const text of [
    '[features]\n"ho\\u006fks" = false\n',
    '[agents]\n"max_\\U00000064epth" = 0\n',
    '["fe\\u0061tures"]\nhooks = true\n',
    '[features."h\\u006foks"]\ncustom = true\n',
    '"fea\\u0074ures".hooks = false\n',
  ]) {
    t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
    t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
  }
  for (const text of [
    'name = "escaped \\u0061 and \\U00000062"\n',
    "'ho\\u006fks' = false\n",
    "['fe\\u0061tures']\ncustom = true\n",
  ])
    t.assert.equal(enableCodex(text).text.startsWith(text), true);
});

test("Codex rejects tables and dotted children colliding with managed scalar keys", (t) => {
  for (const [section, key] of [
    ["features", "hooks"],
    ["agents", "max_depth"],
  ])
    for (const name of [key, `"${key}"`, `'${key}'`])
      for (const text of [
        `[${section}.${name}]\ncustom = true\n`,
        `["${section}" . ${name} . nested]\ncustom = true\n`,
        `[[ '${section}' . ${name} ]]\ncustom = true\n`,
        `[${section}]\n${name}.custom = true\n`,
      ]) {
        t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
        t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
      }
  for (const text of [
    "[features.other]\ncustom = true\n",
    "[agents.other]\ncustom = true\n",
  ])
    t.assert.equal(enableCodex(text).text.startsWith(text), true);
});

test("Codex refuses unfinished ordinary strings before accepting apparent activation", (t) => {
  for (const prefix of [
    'name = "unfinished',
    "name = 'unfinished",
    'name = "escaped\\',
  ])
    for (const suffix of [
      "",
      "\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n",
    ])
      for (const newline of ["\n", "\r\n"]) {
        const text = `${prefix}${suffix}`.replaceAll("\n", newline);
        t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
        t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
      }
});

test("Codex removal deletes owned empty table headers while preserving existing and populated tables", (t) => {
  const created = enableCodex(null);
  const unrelated = '[provider]\nmodel = "keep"\n';
  const removed = removeCodex(
    `${created.text}\n${unrelated}`,
    created.content,
    null,
  );
  t.assert.doesNotMatch(removed ?? "", /\[(features|agents)\]/);
  t.assert.match(removed ?? "", /model = "keep"/);
  const populated = removeCodex(
    `${created.text}user_setting = true\n`,
    created.content,
    null,
  );
  t.assert.doesNotMatch(populated ?? "", /\[features\]/);
  t.assert.match(populated ?? "", /\[agents\][\s\S]*user_setting = true/);
  t.assert.throws(
    () =>
      removeCodex(
        created.text.replace("[features]", '["features"]'),
        created.content,
        null,
      ),
    /INSTALL-CONFLICT/,
  );
  const before = "[features]\n# preexisting table\n[agents]\n";
  const existing = enableCodex(before);
  t.assert.match(
    removeCodex(`${existing.text}\n${unrelated}`, existing.content, before) ??
      "",
    /\[features\]/,
  );
  const legacy = JSON.parse(created.content).map(
    (/** @type {{createdTable?:boolean}} */ item) => {
      delete item.createdTable;
      return item;
    },
  );
  t.assert.match(
    removeCodex(
      `${created.text}\n${unrelated}`,
      JSON.stringify(legacy),
      null,
    ) ?? "",
    /\[features\]/,
  );
});

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
