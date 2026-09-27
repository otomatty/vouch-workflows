import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { test } from "node:test";
import runtime from "../../core/registry/runtime.json" with { type: "json" };
import { packageRun, tree } from "../helpers/packaging.mjs";
import { validator } from "../helpers/registry.mjs";
import { sandbox } from "../helpers/runtime.mjs";
import { commands, frontmatter } from "../helpers/skills.mjs";

const files = readdirSync("core/skills", {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => `${entry.parentPath}/${entry.name}`.replaceAll("\\", "/"));

test("every shipped Skill declares a schema-valid interface matching its directory", (t) => {
  const entries = files.filter((file) => file.endsWith("/SKILL.md"));
  t.plan(1 + entries.length * 2);
  t.assert.equal(entries.includes("core/skills/vouch/SKILL.md"), true);
  for (const file of entries) {
    const data = frontmatter(readFileSync(file, "utf8"));
    const validate = validator("skill-frontmatter");
    t.assert.equal(validate(data), true, JSON.stringify(validate.errors));
    t.assert.equal(data.name, basename(dirname(file)));
  }
});

test("Skill frontmatter rejects duplicate keys and unsupported syntax without silent coercion", (t) => {
  t.plan(5);
  t.assert.deepEqual(
    frontmatter(
      '---\nname: vouch\ndescription: "Doctor: runtime"\nuser-invocable: true\nreads: always\n---\n',
    ),
    {
      name: "vouch",
      description: "Doctor: runtime",
      "user-invocable": true,
      reads: "always",
    },
  );
  for (const text of [
    "no header",
    "---\nname: vouch\nname: vouch\n---\n",
    "---\nreads: [always]\n---\n",
    "---\ndescription: |\n  text\n---\n",
  ])
    t.assert.throws(() => frontmatter(text), /DOC-1/);
});

test("doctor Skill commands are registered Node entries and core text has no harness paths", (t) => {
  const texts = files.map((file) => readFileSync(file, "utf8"));
  const instructions = texts.flatMap(commands);
  t.plan(3 + instructions.length);
  t.assert.equal(instructions.length > 0, true);
  t.assert.equal(
    texts.some((text) => /\.(?:claude|codex|agents)\//.test(text)),
    false,
    "STR-3",
  );
  t.assert.equal(
    texts.some((text) => /\b(?:bun|npx|curl)\b/.test(text)),
    false,
    "DOC-3",
  );
  for (const line of instructions) {
    const match =
      /^node "\{\{HARNESS_DIR\}\}\/hooks\/(vouch-[a-z-]+\.mjs)"$/.exec(line);
    t.assert.equal(
      Boolean(match?.[1] && runtime.commands.includes(match[1])),
      true,
      `DOC-3: ${line}`,
    );
  }
});

test("Skill distribution preserves source bytes except the declared harness token", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  t.plan(2 + files.length * 2);
  t.assert.equal(files.length > 0, true);
  t.assert.equal(result.status, 0, result.stderr);
  for (const harness of ["claude", "codex"]) {
    const installed = tree(box.path(`dist/${harness}`));
    const target = harness === "claude" ? ".claude" : ".agents";
    for (const file of files) {
      const name = relative("core/skills", file).replaceAll("\\", "/");
      const expected = readFileSync(file, "utf8").replaceAll(
        "{{HARNESS_DIR}}",
        `.${harness}`,
      );
      t.assert.equal(
        installed[`${target}/skills/${name}`],
        Buffer.from(expected).toString("base64"),
        `STR-4: ${harness} ${name}`,
      );
    }
  }
});
