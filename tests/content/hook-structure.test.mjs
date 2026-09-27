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
    t.assert.match(
      name,
      command
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
      [command ? "runDoctor(main, import.meta.url);" : "run(main);"],
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
