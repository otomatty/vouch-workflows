import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import pkg from "../../package.json" with { type: "json" };

test("package declares an ESM runtime without production dependencies", (t) => {
  t.plan(3);
  t.assert.equal(pkg.type, "module", "HOOK-1");
  t.assert.equal("dependencies" in pkg, false, "DEP-1");
  t.assert.equal(pkg.engines.node, ">=22.19.0", "DEP-1");
});

test("development dependencies have exact versions matching the lockfile", (t) => {
  const lock = JSON.parse(
    readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
  );
  t.plan(Object.keys(pkg.devDependencies).length * 2 + 1);
  t.assert.deepEqual(
    lock.packages[""].devDependencies,
    pkg.devDependencies,
    "DEP-2",
  );
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    t.assert.match(version, /^\d+\.\d+\.\d+$/, `DEP-2: ${name}`);
    t.assert.equal(
      lock.packages[`node_modules/${name}`].version,
      version,
      `DEP-2: ${name}`,
    );
  }
});

test("runtime libraries have matching unit test files", (t) => {
  const libraries = readdirSync("core/hooks/lib").filter((name) =>
    name.endsWith(".mjs"),
  );
  const tests = readdirSync("tests/unit/lib");
  t.plan(1);
  t.assert.deepEqual(
    libraries.filter(
      (name) => !tests.includes(name.replace(/\.mjs$/, ".test.mjs")),
    ),
    [],
    "TEST-1",
  );
});

test("hook entries have matching process contract test files", (t) => {
  const hooks = readdirSync("core/hooks").filter((name) =>
    name.endsWith(".mjs"),
  );
  const tests = readdirSync("tests/hooks");
  t.plan(1);
  t.assert.deepEqual(
    hooks.filter(
      (name) => !tests.includes(name.replace(/\.mjs$/, ".test.mjs")),
    ),
    [],
    "TEST-3",
  );
});
