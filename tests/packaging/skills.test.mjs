import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";
import { doctorCommand } from "../helpers/skills.mjs";

test("both harnesses ship equivalent Skills with resolving references and doctor commands", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  t.assert.equal(result.status, 0, result.stderr);
  /** @type {Record<string,string[]>} */ const texts = {};
  let assertions = 1;
  for (const harness of ["claude", "codex"]) {
    const root = box.path(`dist/${harness}`);
    const prefix = `${harness === "claude" ? ".claude" : ".agents"}/skills/`;
    const names = Object.keys(tree(root)).filter((name) =>
      name.startsWith(prefix),
    );
    t.assert.deepEqual(
      names.sort(),
      [`${prefix}vouch/SKILL.md`, `${prefix}vouch/references/doctor.md`].sort(),
    );
    assertions++;
    texts[harness] = [];
    for (const name of names) {
      const path = join(root, name);
      const text = readFileSync(path, "utf8");
      texts[harness].push(text.replaceAll(`.${harness}/`, "{{HARNESS_DIR}}/"));
      t.assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/);
      assertions++;
      const links = [...text.matchAll(/\]\(([^)]+)\)/g)]
        .map((m) => m[1] ?? "")
        .filter((link) => !/^https?:/.test(link));
      const paths = [
        ...text.matchAll(/\.(?:claude|codex)\/[a-zA-Z0-9./_-]+/g),
      ].map((m) => m[0]);
      for (const target of [
        ...links.map((link) => join(dirname(path), link)),
        ...paths.map((p) => join(root, p)),
      ]) {
        t.assert.equal(
          !relative(root, target).startsWith("..") && existsSync(target),
          true,
          `DOC-6: ${target}`,
        );
        assertions++;
      }
    }
    const command = doctorCommand(
      readFileSync(join(root, `${prefix}vouch/references/doctor.md`), "utf8"),
    );
    t.assert.equal(command.entry, `.${harness}/hooks/vouch-doctor.mjs`);
    assertions++;
  }
  t.assert.deepEqual(texts.claude, texts.codex);
  t.plan(assertions + 1);
});
