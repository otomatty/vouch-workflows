import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";
import { doctorCommand } from "../helpers/skills.mjs";

test("both harnesses ship equivalent Skills with resolving references and doctor commands", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  const installations = ["claude", "codex"].map((harness) => {
    const root = box.path(`dist/${harness}`);
    const prefix = `${harness === "claude" ? ".claude" : ".agents"}/skills/`;
    const names = Object.keys(tree(root)).filter((name) =>
      name.startsWith(prefix),
    );
    const documents = names.map((name) => {
      const path = join(root, name);
      const text = readFileSync(path, "utf8");
      const links = [...text.matchAll(/\]\(([^)]+)\)/g)]
        .map((m) => m[1] ?? "")
        .filter((link) => !/^https?:/.test(link));
      const paths = [
        ...text.matchAll(/\.(?:claude|codex)\/[a-zA-Z0-9./_-]+/g),
      ].map((m) => m[0]);
      return {
        text,
        targets: [
          ...links.map((link) => join(dirname(path), link)),
          ...paths.map((p) => join(root, p)),
        ],
      };
    });
    return { harness, root, prefix, names, documents };
  });
  t.plan(
    2 +
      installations.reduce(
        (total, item) =>
          total +
          2 +
          item.documents.reduce(
            (count, doc) => count + 1 + doc.targets.length,
            0,
          ),
        0,
      ),
  );
  t.assert.equal(result.status, 0, result.stderr);
  const texts: Record<string, string[]> = {};
  for (const { harness, root, prefix, names, documents } of installations) {
    t.assert.deepEqual(
      names.sort(),
      [
        `${prefix}vouch/SKILL.md`,
        `${prefix}vouch-intent/SKILL.md`,
        `${prefix}vouch-design/SKILL.md`,
        `${prefix}vouch-build/SKILL.md`,
        `${prefix}vouch-verify/SKILL.md`,
        `${prefix}vouch-knowledge/SKILL.md`,
        ...["background", "code", "design", "infra", "rules"].map(
          (name) => `${prefix}vouch-knowledge/references/${name}.md`,
        ),
        ...[
          "ask",
          "doctor",
          "migrate",
          "questions",
          "report",
          "resume",
          "status",
        ].map((name) => `${prefix}vouch/references/${name}.md`),
      ].sort(),
    );
    texts[harness] = [];
    for (const { text, targets } of documents) {
      texts[harness].push(text.replaceAll(`.${harness}/`, "{{HARNESS_DIR}}/"));
      t.assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/);
      for (const target of targets)
        t.assert.equal(
          !relative(root, target).startsWith("..") && existsSync(target),
          true,
          `DOC-6: ${target}`,
        );
    }
    const command = doctorCommand(
      readFileSync(join(root, `${prefix}vouch/references/doctor.md`), "utf8"),
    );
    t.assert.equal(command.entry, `.${harness}/hooks/vouch-doctor.mjs`);
  }
  t.assert.deepEqual(texts.claude, texts.codex);
});
