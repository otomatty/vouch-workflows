import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  nativeDirectory,
  registration,
  registrationPath,
  skillsDirectory,
} from "../../../core/hooks/lib/installation-registration.mjs";

test("native registrations keep each harness's event names, actions and project arguments", (t) => {
  const project = resolve("project");
  for (const harness of ["claude", "codex", "cursor"]) {
    const canonical = `.vouch/versions/${"a".repeat(64)}/${harness}`;
    const runtime = join(project, canonical);
    t.assert.equal(nativeDirectory(harness), `.${harness}`);
    t.assert.equal(
      skillsDirectory(harness),
      harness === "codex" ? ".agents/skills" : `.${harness}/skills`,
    );
    t.assert.equal(
      registrationPath(harness),
      harness === "claude" ? ".claude/settings.json" : `.${harness}/hooks.json`,
    );
    for (const platform of ["linux", "win32"])
      for (const [
        root,
        activeProject,
      ] of /** @type {[string,string|undefined][]} */ ([
        [runtime, project],
        [resolve("home with ' quote", canonical), project],
        [resolve("home with ' quote", canonical), undefined],
        [join(project, "custom-runtime"), project],
      ])) {
        const spec = JSON.parse(
          JSON.stringify(
            registration(
              harness,
              root,
              activeProject ? "project" : "user",
              activeProject,
              /** @type {NodeJS.Platform} */ (platform),
            ),
          ),
        );
        t.assert.deepEqual(
          Object.keys(spec.hooks),
          harness === "cursor"
            ? [
                "sessionStart",
                "beforeSubmitPrompt",
                "preToolUse",
                "afterAgentResponse",
                "stop",
              ]
            : ["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"],
        );
        if (harness === "claude") {
          const hook = spec.hooks.SessionStart[0].hooks[0];
          t.assert.equal(hook.command, "node");
          t.assert.equal(hook.args[1], "session");
          t.assert.equal(hook.args[2], activeProject ? "project" : "user");
          t.assert.equal(hook.args.length, activeProject ? 4 : 3);
          t.assert.match(spec.statusLine.command, /node/);
        } else if (harness === "codex") {
          const hook = spec.hooks.PreToolUse[0].hooks[0];
          t.assert.match(hook.command, /guard/);
          t.assert.match(hook.commandWindows, /exit \$LASTEXITCODE$/);
          if (activeProject) {
            t.assert.match(hook.command, /vouch_project_root=\$\(pwd -P\)/);
            t.assert.match(hook.commandWindows, /Get-Location/);
          }
        } else {
          t.assert.match(spec.hooks.preToolUse[0].command, /guard/);
          if (root === runtime && activeProject)
            t.assert.equal(
              spec.hooks.preToolUse[0].command,
              `node ${canonical}/hooks/vouch-launch.mjs guard project .`,
            );
        }
      }
  }
});

test("Windows statusline carries paths as data and different-volume Cursor commands stay absolute", (t) => {
  const root = resolve("home with ' quote and $ characters");
  const spec = registration("claude", root, "user", undefined, "win32");
  const value = JSON.parse(JSON.stringify(spec));
  const encoded = value.statusLine.command.match(
    /Buffer.from\('([A-Za-z0-9+/=]+)'/,
  )[1];
  t.assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64").toString()), {
    entry: join(root, "hooks/vouch-launch.mjs"),
    scope: "user",
    project: false,
  });
  const cursor = JSON.parse(
    JSON.stringify(
      registration("cursor", "D:\\runtime", "project", "C:\\project", "win32"),
    ),
  );
  t.assert.match(cursor.hooks.preToolUse[0].command, /^& node /);
});
