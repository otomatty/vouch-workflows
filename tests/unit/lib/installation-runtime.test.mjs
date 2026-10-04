import { test } from "node:test";
import {
  distributionDigest,
  installedText,
  isSnapshotName,
  markdownDestination,
  runtimeContents,
  verifyManagedRuntime,
} from "../../../core/hooks/lib/installation-runtime.mjs";
import runtime from "../../../core/registry/runtime.json" with { type: "json" };
import { memoryFiles } from "../../helpers/runtime.mjs";

test("snapshot validation accepts simple lowercase native filenames and rejects nested or incompatible names", (t) => {
  t.assert.equal(isSnapshotName("hooks.json", "registration"), true);
  t.assert.equal(isSnapshotName("custom-config.toml", "configuration"), true);
  for (const value of [
    null,
    123,
    "",
    "registry/runtime.json",
    "Invalid.json",
    "hooks1.json",
    "hooks.toml",
  ])
    t.assert.equal(isSnapshotName(value, "registration"), false);
  t.assert.equal(isSnapshotName("config.json", "configuration"), false);
});

/** @param {import("../../../core/hooks/lib/contracts.mjs").Harness} [harness] @param {string} [scope] */
function fixture(harness = "codex", scope = "user") {
  const source = Object.fromEntries([
    ...runtime.files.map((path) => [`.${harness}/${path}`, `content: ${path}`]),
    ...runtime.assets[harness].map((path) => [path, `content: ${path}`]),
  ]);
  source["AGENTS.md"] =
    `Read [rules](.${harness}/templates/rules.md) and run \`node .${harness}/hooks/vouch-doctor.mjs\`.`;
  source[`.${harness}/registry/runtime.json`] = JSON.stringify(runtime);
  source[`.${harness}/registry/installation.json`] = JSON.stringify({
    harness,
    registration: "selected-hooks.json",
    ...(harness === "codex" ? { configuration: "selected-config.toml" } : {}),
  });
  source[`.${harness}/selected-hooks.json`] = '{"hooks":{}}';
  if (harness === "codex")
    source[`.${harness}/selected-config.toml`] = "# selected configuration\n";
  source[`.${harness}/templates/rules.md`] =
    `See .${harness}/registry/workflow.json`;
  source[`.${harness}/skills/vouch/SKILL.md`] = "owned activation";
  const state = { harness, scope, digest: distributionDigest(source) };
  const root = "/home/owner/.vouch/versions/runtime";
  const reference =
    scope === "project" ? `.vouch/versions/${state.digest}/${harness}` : root;
  const store = memoryFiles({
    ...Object.fromEntries(
      Object.entries(source).map(([path, text]) => [
        `distribution/${path}`,
        text,
      ]),
    ),
    ...runtimeContents(source, harness, reference),
  });
  return { source, state, root, store };
}

test("descriptor-selected snapshots join runtime integrity in every harness and scope", async (t) => {
  for (const harness of /** @type {const} */ (["claude", "codex", "cursor"]))
    for (const scope of ["project", "user"])
      for (const path of [
        "selected-hooks.json",
        ...(harness === "codex" ? ["selected-config.toml"] : []),
      ]) {
        const { source, state, root, store } = fixture(harness, scope);
        t.assert.equal(
          runtimeContents(source, harness, root)[path],
          source[`.${harness}/${path}`],
        );
        for (const text of [null, "changed nonempty bytes", ""]) {
          if (text === null) store.data.delete(path);
          else store.data.set(path, text);
          const before = new Map(store.data);
          await t.assert.rejects(
            verifyManagedRuntime(store, state, root),
            /INSTALL-VERSION/,
          );
          t.assert.deepEqual(store.data, before);
        }
      }
});

test("every managed harness and scope verifies transformed guidance and complete immutable archive without writes", async (t) => {
  for (const harness of ["claude", "codex", "cursor"])
    for (const scope of ["project", "user"]) {
      const { store, state, root } = fixture(
        /** @type {import("../../../core/hooks/lib/contracts.mjs").Harness} */ (
          harness
        ),
        scope,
      );
      const before = new Map(store.data);
      await verifyManagedRuntime(store, state, root);
      t.assert.deepEqual(store.data, before);
    }
});

test("complete archive and runtime reads use separate bounded batches and reread every byte on the next verification", async (t) => {
  const { store, state, root, source } = fixture();
  const before = new Map(store.data);
  const read = store.readText;
  const active = { archive: 0, runtime: 0 };
  const maximum = { archive: 0, runtime: 0 };
  /** @type {Map<string,number>} */ const calls = new Map();
  store.readText = async (path) => {
    const phase = path.startsWith("distribution/") ? "archive" : "runtime";
    t.assert.equal(active[phase === "archive" ? "runtime" : "archive"], 0);
    active[phase] += 1;
    maximum[phase] = Math.max(maximum[phase], active[phase]);
    calls.set(path, (calls.get(path) ?? 0) + 1);
    try {
      await new Promise((done) => setImmediate(done));
      return await read(path);
    } finally {
      active[phase] -= 1;
    }
  };
  for (const count of [1, 2]) {
    t.assert.deepEqual(await verifyManagedRuntime(store, state, root), source);
    t.assert.deepEqual(maximum, { archive: 4, runtime: 4 });
    t.assert.deepEqual(active, { archive: 0, runtime: 0 });
    t.assert.deepEqual(
      calls,
      new Map([...before.keys()].map((path) => [path, count])),
    );
    t.assert.deepEqual(store.data, before);
  }
});

test("archive digest ignores insertion order and includes every filename and exact content", (t) => {
  const source = { a: "first\n", b: "second" };
  t.assert.equal(
    distributionDigest(source),
    distributionDigest({ b: "second", a: "first\n" }),
  );
  t.assert.notEqual(
    distributionDigest(source),
    distributionDigest({ a: "first", b: "second" }),
  );
  t.assert.notEqual(
    distributionDigest(source),
    distributionDigest({ c: "first\n", b: "second" }),
  );
});

test("a matching digest and rewritten asset inventory cannot hide any missing or empty canonical asset", async (t) => {
  for (const harness of /** @type {const} */ (["claude", "codex", "cursor"]))
    for (const path of runtime.assets[harness].filter(
      (path) =>
        path.endsWith("vouch-build/SKILL.md") ||
        path.endsWith("templates/ja/rules.md"),
    ))
      for (const missing of [true, false]) {
        const { source, store, state, root } = fixture(harness);
        if (missing) delete source[path];
        else source[path] = "";
        source[`.${harness}/registry/runtime.json`] = JSON.stringify({
          ...runtime,
          assets: {},
        });
        state.digest = distributionDigest(source);
        for (const at of [...store.data.keys()])
          if (at.startsWith("distribution/")) store.data.delete(at);
        for (const [at, text] of Object.entries(source))
          store.data.set(`distribution/${at}`, text);
        const before = new Map(store.data);
        await t.assert.rejects(
          verifyManagedRuntime(store, state, root),
          /INSTALL-SOURCE/,
          `${harness}: ${path}`,
        );
        t.assert.deepEqual(store.data, before);
      }
});

test("managed archive changes and every materialized runtime kind are rejected without writes", async (t) => {
  for (const path of [
    "distribution/AGENTS.md",
    "distribution/extra.txt",
    "AGENTS.md",
    "hooks/vouch-guard-writes.mjs",
    "registry/workflow.json",
    "templates/rules.md",
  ]) {
    const { store, state, root } = fixture();
    store.data.set(path, "nonempty changed bytes");
    const before = new Map(store.data);
    await t.assert.rejects(
      verifyManagedRuntime(store, state, root),
      /INSTALL-VERSION/,
    );
    t.assert.deepEqual(store.data, before);
  }
});

test("a matching digest cannot certify missing guidance, omitted mandatory files or invalid inventory entries", async (t) => {
  for (const variant of [
    "missing-inventory",
    "malformed",
    "missing-guidance",
    "missing-file",
    "omitted-file",
    "extra-missing",
    "invalid-path",
  ]) {
    const { source, store, state, root } = fixture();
    const key = ".codex/registry/runtime.json";
    if (variant === "missing-inventory") delete source[key];
    if (variant === "malformed") source[key] = "{}";
    if (variant === "missing-guidance") delete source["AGENTS.md"];
    if (variant === "missing-file") delete source[`.codex/${runtime.files[0]}`];
    if (variant === "omitted-file")
      source[key] = JSON.stringify({ files: runtime.files.slice(1) });
    if (variant === "extra-missing")
      source[key] = JSON.stringify({ files: [...runtime.files, "absent"] });
    if (variant === "invalid-path")
      source[key] = JSON.stringify({ files: [...runtime.files, 123] });
    for (const path of [...store.data.keys()])
      if (path.startsWith("distribution/")) store.data.delete(path);
    for (const [path, text] of Object.entries(source))
      store.data.set(`distribution/${path}`, text);
    state.digest = distributionDigest(source);
    await t.assert.rejects(
      verifyManagedRuntime(store, state, root),
      /INSTALL-SOURCE/,
    );
  }
});

test("missing archives, vanished entries, links, other nodes and read failures are not accepted", async (t) => {
  const { store, state, root } = fixture();
  const list = store.list;
  store.list = async () => null;
  await t.assert.rejects(
    verifyManagedRuntime(store, state, root),
    /archived distribution missing/,
  );
  for (const kind of ["link", "other"]) {
    store.list = async () => [
      { name: "unsafe", kind: /** @type {'link'|'other'} */ (kind) },
    ];
    await t.assert.rejects(
      verifyManagedRuntime(store, state, root),
      /INSTALL-LINK/,
    );
  }
  store.list = async () => [{ name: "absent", kind: "file" }];
  await t.assert.rejects(
    verifyManagedRuntime(store, state, root),
    /archived file missing/,
  );
  store.list = list;
  const failure = new Error("disk denied");
  store.readText = async () => {
    throw failure;
  };
  await t.assert.rejects(
    verifyManagedRuntime(store, state, root),
    (error) => error === failure,
  );
});

test("guidance rebinding preserves Markdown syntax and shell quoting on both host families", (t) => {
  t.assert.equal(
    markdownDestination("owner's/(path)#?\\file"),
    process.platform === "win32"
      ? "<owner%27s/%28path%29%23%3F/file>"
      : "<owner%27s/%28path%29%23%3F%5Cfile>",
  );
  for (const platform of ["linux", "win32"]) {
    const text = installedText(
      'Read [rules](.codex/templates/rules.md), `.codex/file`, and `node ".codex/hooks/vouch-doctor.mjs"`; node .codex/hooks/vouch-report.mjs .codex/plain',
      "codex",
      "owner's`root",
      /** @type {'linux'|'win32'} */ (platform),
    );
    t.assert.match(text, /vouch-launch\.mjs.*doctor manual/);
    t.assert.match(text, /vouch-launch\.mjs.*report manual/);
    t.assert.match(text, /owner%27s%60root\/templates\/rules\.md/);
    t.assert.match(text, /`` .*root\/file ``/);
    t.assert.equal(
      text.includes(platform === "win32" ? "owner''s" : "owner'\\''s"),
      true,
    );
  }
  t.assert.equal(
    installedText(
      "developer_instructions = '''\nhello\n'''\n",
      "codex",
      "/runtime",
    ),
    'developer_instructions = "hello\\n"\n',
  );
  t.assert.equal(installedText("unchanged", "claude", "/runtime"), "unchanged");
});

test("references preserve literal POSIX backslashes and normalize Windows separators", (t) => {
  t.assert.equal(
    markdownDestination("/tmp/home\\name/file", "linux"),
    "</tmp/home%5Cname/file>",
  );
  t.assert.equal(
    markdownDestination("C:\\home\\name\\file", "win32"),
    "<C:/home/name/file>",
  );
  for (const harness of ["claude", "codex", "cursor"])
    for (const platform of /** @type {const} */ (["linux", "win32"])) {
      const root =
        platform === "linux"
          ? "/tmp/home\\name/runtime"
          : "C:\\home\\name\\runtime";
      const reference = platform === "linux" ? root : "C:/home/name/runtime";
      const text = installedText(
        `[rules](.${harness}/AGENTS.md) and \`node .${harness}/hooks/vouch-doctor.mjs\``,
        harness,
        root,
        platform,
      );
      t.assert.equal(
        text.includes(`${reference}/hooks/vouch-launch.mjs`),
        true,
        text,
      );
      t.assert.equal(
        text.includes(
          platform === "linux"
            ? "home%5Cname/runtime/AGENTS.md"
            : "home/name/runtime/AGENTS.md",
        ),
        true,
        text,
      );
    }
});
