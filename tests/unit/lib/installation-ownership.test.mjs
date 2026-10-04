import { test } from "node:test";
import {
  block,
  restoreOwned,
} from "../../../core/hooks/lib/installation-ownership.mjs";

const owned = {
  path: "owned",
  kind: "file",
  content: "installed",
  previous: null,
};

test("managed documentation has fixed markers and preserves the original newline boundary", (t) => {
  const expected =
    "\n<!-- vouch:cursor:start -->\nread rules\n<!-- vouch:cursor:end -->\n";
  t.assert.equal(block(null, "cursor", "read rules"), expected);
  t.assert.equal(block("user\n", "cursor", "read rules"), expected);
  t.assert.equal(block("user", "cursor", "read rules"), `\n${expected}`);
  t.assert.throws(
    () => block(expected, "cursor", "read rules"),
    /INSTALL-CONFLICT/,
  );
});

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
