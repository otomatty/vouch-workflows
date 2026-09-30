import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";
import budgets from "../../core/registry/budgets.json" with { type: "json" };

/** @param {string} directory */
function sourceFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(mjs|md)$/.test(entry.name))
    .map((entry) =>
      relative(".", resolve(entry.parentPath, entry.name)).replaceAll(
        "\\",
        "/",
      ),
    );
}
/** @param {string} file */
function lines(file) {
  const content = readFileSync(file, "utf8");
  return content === ""
    ? 0
    : content.split("\n").length - Number(content.endsWith("\n"));
}

test("runtime sources stay within the file and total line budgets", (t) => {
  const sources = sourceFiles("core/hooks").filter((file) =>
    file.endsWith(".mjs"),
  );
  const libraries = sources.filter((file) =>
    file.startsWith("core/hooks/lib/"),
  );
  const hooks = sources.filter((file) => !libraries.includes(file));
  t.plan(sources.length + 1);
  for (const file of sources) {
    const limit = libraries.includes(file)
      ? budgets.lines.libFile
      : budgets.lines.hookFile;
    t.assert.equal(
      lines(file) <= limit,
      true,
      `HOOK-12: ${file} exceeds ${limit} lines`,
    );
  }
  t.assert.equal(
    hooks.reduce((total, file) => total + lines(file), 0) <=
      budgets.lines.hooksTotal,
    true,
    "HOOK-12: hook total",
  );
  t.diagnostic(
    `Runtime lib total: ${libraries.reduce((total, file) => total + lines(file), 0)} lines; review responsibility boundaries (docs/development/coding-rules.md).`,
  );
});

test("workflow documents and packaging stay within their line budgets", (t) => {
  const skills = sourceFiles("core/skills").filter((file) =>
    file.endsWith("/SKILL.md"),
  );
  const agents = sourceFiles("core/agents");
  const entries = [
    ...skills.map((file) => ({
      file,
      limit:
        file === "core/skills/vouch/SKILL.md"
          ? budgets.lines.orchestrator
          : budgets.lines.stageSkill,
    })),
    ...agents.map((file) => ({ file, limit: budgets.lines.agent })),
    { file: "core/AGENTS.md", limit: budgets.lines.agentsMd },
    { file: "scripts/package.mjs", limit: budgets.lines.packageScript },
  ].filter(({ file }) => existsSync(file));
  t.plan(entries.length + 2);
  for (const { file, limit } of entries)
    t.assert.equal(lines(file) <= limit, true, `DOC-2/STR-6: ${file}`);
  for (const language of ["ja", "en"]) {
    const files = [
      "core/AGENTS.md",
      "core/skills/vouch/SKILL.md",
      `core/templates/${language}/rules.md`,
    ].filter(existsSync);
    const bytes = files.reduce(
      (total, file) => total + readFileSync(file).byteLength,
      0,
    );
    t.assert.equal(
      Math.ceil(bytes / budgets.context.bytesPerToken) <=
        budgets.context.alwaysLoadedTokens,
      true,
      `DOC-2: ${language} context budget`,
    );
  }
});
