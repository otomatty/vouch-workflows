import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  activationFiles,
  activationGuidance,
  verifyActivationContents,
} from "../../../core/hooks/lib/installation-contributions.mjs";
import { block } from "../../../core/hooks/lib/installation-ownership.mjs";
import {
  registration,
  registrationPath,
  skillsDirectory,
} from "../../../core/hooks/lib/installation-registration.mjs";
import { enableCodex } from "../../../core/hooks/lib/installation-toml.mjs";

/** @param {string} harness @param {string} scope */
function fixture(harness, scope) {
  const projectRoot = resolve("project with ' characters");
  const canonical = `.vouch/versions/${"a".repeat(64)}/${harness}`;
  const runtimeRoot = join(
    scope === "project" ? projectRoot : resolve("home"),
    canonical,
  );
  const referenceRoot = scope === "project" ? canonical : runtimeRoot;
  const source = {
    [`${skillsDirectory(harness)}/vouch/SKILL.md`]: `Read [rules](.${harness}/AGENTS.md).`,
    [`${skillsDirectory(harness)}/vouch/schema.json`]: `{"literal":".${harness}/"}`,
    [`.${harness}/agents/check.toml`]: `developer_instructions = '''\nUse .${harness}/registry/workflow.json\n'''\n`,
    [`.${harness}/hooks/unused.mjs`]: "not an activation contribution",
  };
  const owned = [
    ...Object.entries(activationFiles(source, harness, referenceRoot)).map(
      ([path, content]) => ({ path, kind: "file", content, previous: null }),
    ),
    ...activationGuidance(harness, referenceRoot).map((item) => ({
      ...item,
      content:
        item.kind === "block"
          ? block(null, harness, item.content)
          : item.content,
      previous: null,
    })),
    {
      path: registrationPath(harness),
      kind: "hooks",
      content: JSON.stringify(
        registration(harness, runtimeRoot, "project", projectRoot),
      ),
      previous: null,
    },
    ...(harness === "codex"
      ? [
          {
            path: ".codex/config.toml",
            kind: "toml",
            content: enableCodex(null).content,
            previous: null,
          },
        ]
      : []),
  ];
  return {
    source,
    owned,
    context: { harness, scope, runtimeRoot, projectRoot },
  };
}

test("trusted contributions accept both scopes and reject jointly changed content for every harness and kind", (t) => {
  for (const harness of ["claude", "codex", "cursor"])
    for (const scope of ["project", "user"]) {
      const box = fixture(harness, scope);
      const before = JSON.stringify(box);
      t.assert.doesNotThrow(() =>
        verifyActivationContents(box.source, box.context, box.owned),
      );
      t.assert.equal(JSON.stringify(box), before);
      t.assert.equal(
        activationFiles(box.source, harness, "elsewhere")[
          `${skillsDirectory(harness)}/vouch/schema.json`
        ],
        box.source[`${skillsDirectory(harness)}/vouch/schema.json`],
      );
      for (let index = 0; index < box.owned.length; index++) {
        const entries = JSON.parse(JSON.stringify(box.owned));
        const entry = entries[index];
        entry.content =
          entry.kind === "hooks"
            ? entry.content.replaceAll("vouch-launch.mjs", "other-launch.mjs")
            : entry.kind === "toml"
              ? entry.content.replace("hooks = true", "hooks = false")
              : `${entry.content}\nchanged contribution`;
        t.assert.throws(
          () => verifyActivationContents(box.source, box.context, entries),
          /trusted activation/,
        );
      }
      for (const field of ["content", "previous"]) {
        const entries = JSON.parse(JSON.stringify(box.owned));
        entries[0][field] = 42;
        t.assert.throws(
          () => verifyActivationContents(box.source, box.context, entries),
          /invalid owned contribution/,
        );
      }
    }
});

test("user statusline stays outside ownership while native hooks still match trusted commands", (t) => {
  const box = fixture("claude", "user");
  const hook = box.owned.find((item) => item.kind === "hooks");
  if (!hook) throw new Error("missing fixture hook");
  const entries = JSON.parse(JSON.stringify(box.owned));
  const edited = entries.find(
    (/** @type {{kind:string}} */ item) => item.kind === "hooks",
  );
  edited.previous = JSON.stringify({ statusLine: { command: "user display" } });
  const contribution = JSON.parse(edited.content);
  delete contribution.statusLine;
  edited.content = JSON.stringify(contribution);
  t.assert.doesNotThrow(() =>
    verifyActivationContents(box.source, box.context, entries),
  );
  edited.content = hook.content;
  t.assert.throws(
    () => verifyActivationContents(box.source, box.context, entries),
    /trusted activation/,
  );
});

test("legacy Codex ownership may omit createdTable but cannot change the known settings", (t) => {
  const box = fixture("codex", "user");
  for (const variant of [
    "legacy",
    "wrong-header",
    "null",
    "null-setting",
    "empty",
  ]) {
    const entries = JSON.parse(JSON.stringify(box.owned));
    const setting = entries.find(
      (/** @type {{kind:string}} */ item) => item.kind === "toml",
    );
    const patch = JSON.parse(setting.content);
    if (variant === "legacy")
      for (const item of patch) delete item.createdTable;
    if (variant === "wrong-header") patch[0].createdTable = false;
    setting.content = JSON.stringify(
      variant === "null"
        ? null
        : variant === "null-setting"
          ? [null]
          : variant === "empty"
            ? []
            : patch,
    );
    const before = JSON.stringify(entries);
    if (variant === "legacy")
      t.assert.doesNotThrow(() =>
        verifyActivationContents(box.source, box.context, entries),
      );
    else
      t.assert.throws(
        () => verifyActivationContents(box.source, box.context, entries),
        /trusted activation/,
      );
    t.assert.equal(JSON.stringify(entries), before);
  }
});
