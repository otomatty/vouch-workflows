import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import events from "../../core/registry/audit-events.json" with {
  type: "json",
};
import runtime from "../../core/registry/runtime.json" with { type: "json" };

test("product hooks have a single run(main) entry and registered literal event types", (t) => {
  const entries = readdirSync("core/hooks", { withFileTypes: true });
  const hooks = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".mjs"),
  );
  t.plan(2 + hooks.length * 4);
  t.assert.equal(
    hooks.length > 0,
    true,
    "at least one product entry is required",
  );
  t.assert.deepEqual(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    ["lib"],
    "STR-1",
  );
  for (const { name } of hooks) {
    const command = runtime.commands.includes(name);
    const statusline = runtime.statusline.includes(name);
    t.assert.match(
      name,
      command || statusline
        ? /^vouch-[a-z-]+\.mjs$/
        : /^vouch-[a-z]+-[a-z]+(?:-[a-z]+)*\.mjs$/,
      "STR-1; DIST-5 command",
    );
    const source = ts.createSourceFile(
      name,
      readFileSync(`core/hooks/${name}`, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const effects = source.statements.filter(
      (node) =>
        !ts.isImportDeclaration(node) && !ts.isFunctionDeclaration(node),
    );
    t.assert.deepEqual(
      effects.map((node) => node.getText(source)),
      [
        command
          ? "runDoctor(main, import.meta.url);"
          : statusline
            ? "runStatusline(main, import.meta.url);"
            : "run(main);",
      ],
      "HOOK-2",
    );
    /** @type {string[]} */ const types = [];
    /** @type {string[]} */ const invalid = [];
    /** @param {import('typescript').Node} node */
    function visit(node) {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source).replaceAll(/["']/g, "") === "type"
      ) {
        if (ts.isStringLiteral(node.initializer))
          types.push(node.initializer.text);
        else invalid.push(node.getText(source));
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    t.assert.deepEqual(invalid, [], "HOOK-10: event types must be literals");
    t.assert.deepEqual(
      types.filter((type) => !Object.hasOwn(events.events, type)),
      [],
      "HOOK-10: registered event types",
    );
  }
});

test("runtime source keeps clock and exit access within their boundaries without coverage exclusions", (t) => {
  const files = readdirSync("core/hooks", {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"));
  t.plan(files.length * 3);
  for (const entry of files) {
    const source = readFileSync(`${entry.parentPath}/${entry.name}`, "utf8");
    t.assert.doesNotMatch(
      source,
      /node:coverage\s+(?:ignore|disable)/,
      "TEST-8",
    );
    t.assert.equal(
      entry.name === "io.mjs" || !/process\.(?:exit|exitCode)\b/.test(source),
      true,
      "HOOK-7",
    );
    t.assert.equal(
      entry.name === "clock.mjs" ||
        !/Date\.now\(|new Date\(|Math\.random\(|randomUUID\(/.test(source),
      true,
      "HOOK-8",
    );
  }
});

test("runtime source loads a builtin outside import only for fs and never uses stdio streams", (t) => {
  const files = readdirSync("core/hooks", {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) =>
      `${entry.parentPath}/${entry.name}`
        .replaceAll("\\", "/")
        .replace(/^.*?core\/hooks\//, ""),
    )
    .sort();
  /** @type {string[]} */ const calls = [];
  /** @type {string[]} */ const stdio = [];
  for (const file of files) {
    const source = readFileSync(`core/hooks/${file}`, "utf8");
    // Dependency-cruiser cannot see these loads, so HOOK-5 and HOOK-6 rely on this list.
    for (const match of source.matchAll(/getBuiltinModule\(([^)]*)\)/g))
      calls.push(`${file} ${match[1]}`);
    if (/process\.std(?:in|err)\b/.test(source)) stdio.push(file);
  }
  t.plan(2);
  t.assert.deepEqual(calls, ['lib/fs.mjs "node:fs"'], "HOOK-5; HOOK-6");
  t.assert.deepEqual(stdio, [], "HOOK-13: descriptor stdio");
});

test("HOOK-13 budgets are measured only in performance files under the synthetic CPU load", (t) => {
  const files = readdirSync("tests/hooks")
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const source = (/** @type {string} */ name) =>
    readFileSync(`tests/hooks/${name}`, "utf8");
  const performance = files.filter((name) =>
    name.endsWith("-performance.test.mjs"),
  );
  t.plan(1 + performance.length * 2);
  t.assert.deepEqual(
    // Record and check budgets alike; a check hook guards tool calls.
    files.filter((name) => /\b(?:record|check)P95Ms\b/.test(source(name))),
    performance,
    "HOOK-13: budget files",
  );
  for (const name of performance) {
    t.assert.match(source(name), /= await cpuLoad\(t\);/, `${name}: load`);
    t.assert.match(
      source(name),
      /\} finally \{\s*await load\.stop\(\);\s*\}/,
      `${name}: load stops after measuring`,
    );
  }
});
