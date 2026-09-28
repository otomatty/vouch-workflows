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

/**
 * @typedef {{
 *   dependencies?: Record<string, string>,
 *   optionalDependencies?: Record<string, string>,
 *   devDependencies?: Record<string, string>,
 *   peerDependencies?: Record<string, string>,
 *   peerDependenciesMeta?: Record<string, { optional?: boolean }>,
 * }} LockEntry
 */

/**
 * Resolves a dependency of a lockfile entry in node_modules lookup order.
 * @param {Record<string, LockEntry>} packages
 * @param {string} from
 * @param {string} name
 */
function resolveLocked(packages, from, name) {
  for (let base = from; ; ) {
    const key = `${base && `${base}/`}node_modules/${name}`;
    if (key in packages) return key;
    if (!base) return undefined;
    base = base.slice(0, Math.max(0, base.lastIndexOf("/node_modules/")));
  }
}

/** @param {LockEntry} entry */
function requiredDependencies(entry) {
  const peers = Object.keys(entry.peerDependencies ?? {}).filter(
    (name) => !entry.peerDependenciesMeta?.[name]?.optional,
  );
  return new Set([
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
    ...Object.keys(entry.devDependencies ?? {}),
    ...peers,
  ]);
}

test("lockfile resolves every required dependency and has no unreachable entries", (t) => {
  /** @type {Record<string, LockEntry>} */
  const packages = JSON.parse(
    readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
  ).packages;
  const missing = [];
  const queue = [""];
  const reached = new Set(queue);
  for (const from of queue)
    for (const name of requiredDependencies(packages[from] ?? {})) {
      const key = resolveLocked(packages, from, name);
      if (key === undefined) missing.push(`${from || "(root)"} -> ${name}`);
      else if (!reached.has(key)) {
        reached.add(key);
        queue.push(key);
      }
    }
  t.plan(2);
  t.assert.deepEqual(missing, [], "DEP-2: unresolved lockfile dependencies");
  t.assert.deepEqual(
    Object.keys(packages).filter((key) => !reached.has(key)),
    [],
    "DEP-2: unreachable lockfile entries",
  );
});

test("package manager is outside the npm range that drops lockfile peers", (t) => {
  const [major = 0, minor = 0, patch = 0] = pkg.packageManager
    .replace(/^npm@/, "")
    .split(".")
    .map(Number);
  const version = major * 1e6 + minor * 1e3 + patch;
  t.plan(2);
  t.assert.match(
    pkg.packageManager,
    /^npm@\d+\.\d+\.\d+$/,
    "DEP-2: packageManager is an exact npm version",
  );
  t.assert.equal(
    version >= 11_005_000 && version <= 11_006_002,
    false,
    "DEP-2: npm 11.5.0-11.6.2 must not write the lockfile",
  );
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

test("Windows CI jobs keep temporary files on the runner work volume before any npm step", (t) => {
  const ci = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const steps = ci.split(/\n(?= {6}- )/);
  const temp = steps.findIndex(
    (step) =>
      /if: runner\.os == 'Windows'/.test(step) &&
      /echo "TMP=\$RUNNER_TEMP" >> "\$GITHUB_ENV"/.test(step) &&
      /echo "TEMP=\$RUNNER_TEMP" >> "\$GITHUB_ENV"/.test(step),
  );
  const npm = steps.findIndex((step) => /run: npm /.test(step));
  t.plan(2);
  t.assert.notEqual(temp, -1, "HOOK-13: Windows temp on RUNNER_TEMP");
  t.assert.equal(temp < npm, true, "HOOK-13: set before npm ci and check");
});
