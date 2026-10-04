import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import runtime from "../../core/registry/runtime.json" with { type: "json" };
import { validator } from "../helpers/registry.mjs";

test("the canonical asset inventory includes every source Skill, reference, template and rendered agent in each native layout", (t) => {
  for (const harness of /** @type {const} */ (["claude", "codex", "cursor"])) {
    const expected = [
      "AGENTS.md",
      ...(harness === "claude" ? ["CLAUDE.md"] : []),
    ];
    for (const directory of ["skills", "agents", "templates"]) {
      const root = `core/${directory}`;
      for (const entry of readdirSync(root, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        let name = relative(
          root,
          join(entry.parentPath, entry.name),
        ).replaceAll("\\", "/");
        if (directory === "agents" && harness === "codex")
          name = name.replace(/\.md$/, ".toml");
        const prefix =
          directory === "skills" && harness === "codex"
            ? ".agents/skills"
            : `.${harness}/${directory}`;
        expected.push(`${prefix}/${name}`);
      }
    }
    t.assert.deepEqual(runtime.assets[harness], expected.sort());
  }
  const validate = validator("runtime");
  t.assert.equal(validate(runtime), true);
  const { assets: _assets, ...missing } = runtime;
  t.assert.equal(validate(missing), false);
  t.assert.equal(
    validate({
      ...runtime,
      assets: { ...runtime.assets, cursor: ["../outside"] },
    }),
    false,
  );
});
