import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("shared project documents resolve references and keep user rules uninitialized", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  const installations = ["claude", "codex"].map((harness) => {
    const root = box.path(`dist/${harness}`);
    const all = tree(root);
    const names = Object.keys(all).filter(
      (name) =>
        name === "AGENTS.md" ||
        name === "CLAUDE.md" ||
        name.startsWith(`.${harness}/templates/`),
    );
    const targets = names.flatMap((name) => {
      const path = join(root, name);
      const text = readFileSync(path, "utf8");
      const links = [...text.matchAll(/\]\(([^)]+)\)/g)]
        .map((m) => m[1] ?? "")
        .filter((link) => !/^https?:/.test(link));
      const paths = [
        ...text.matchAll(/\.(?:claude|codex)\/[a-zA-Z0-9./_-]+/g),
      ].map((m) => m[0]);
      return [
        ...links.map((link) => join(dirname(path), link)),
        ...paths.map((p) => join(root, p)),
      ];
    });
    return { harness, root, all, names, targets };
  });
  t.plan(2 + installations.reduce((n, i) => n + 2 + i.targets.length, 0));
  t.assert.equal(result.status, 0, result.stderr);
  for (const { harness, root, all, names, targets } of installations) {
    t.assert.deepEqual(
      names.sort(),
      [
        "AGENTS.md",
        ...(harness === "claude" ? ["CLAUDE.md"] : []),
        `.${harness}/templates/ja/rules.md`,
        `.${harness}/templates/ja/intent.md`,
        `.${harness}/templates/ja/decisions.md`,
        `.${harness}/templates/en/rules.md`,
        `.${harness}/templates/en/intent.md`,
        `.${harness}/templates/en/decisions.md`,
      ].sort(),
    );
    t.assert.equal(
      Object.keys(all).some((p) => p.startsWith("vouch/")),
      false,
    );
    for (const target of targets)
      t.assert.equal(
        !relative(root, target).startsWith("..") && existsSync(target),
        true,
        target,
      );
  }
  t.assert.equal(
    readFileSync(box.path("dist/claude/CLAUDE.md"), "utf8"),
    "@AGENTS.md\n",
  );
});
