import { join } from "node:path";
import { test } from "node:test";
import { registration as generatedRegistration } from "../../../core/hooks/lib/installation-ownership.mjs";
import {
  distributionDigest,
  runtimeContents,
} from "../../../core/hooks/lib/installation-runtime.mjs";
import { launch } from "../../../core/hooks/lib/launch.mjs";
import runtime from "../../../core/registry/runtime.json" with { type: "json" };
import { ports, setup } from "../../helpers/launch.mjs";
import { managedOwned } from "../../helpers/managed-ownership.mjs";

test("native statusline skips inactive or unverified projects and uses registered code to render a validated selection", async (t) => {
  const box = await setup(t, "claude");
  const source = Object.fromEntries([
    ...runtime.files.map((path) => [`.claude/${path}`, "source"]),
    ...runtime.assets.claude.map((path) => [path, "source"]),
  ]);
  source["AGENTS.md"] = "source";
  source[".claude/registry/installation.json"] = JSON.stringify({
    harness: "claude",
    registration: "settings.json",
  });
  source[".claude/settings.json"] = '{"hooks":{}}';
  source[".claude/registry/runtime.json"] = JSON.stringify(runtime);
  let activationOwned = managedOwned("claude");
  for (const entry of activationOwned) {
    await box.box.write(`project/${entry.path}`, entry.content);
    if (entry.kind === "file") source[entry.path] = entry.content;
  }
  box.binding.digest = distributionDigest(source);
  box.binding.runtimeRoot = `.vouch/versions/${box.binding.digest}/claude`;
  activationOwned = managedOwned("claude", box.binding.runtimeRoot);
  for (const entry of activationOwned)
    await box.box.write(`project/${entry.path}`, entry.content);
  for (const [path, text] of Object.entries(
    runtimeContents(source, "claude", box.binding.runtimeRoot),
  ))
    await box.box.write(`project/${box.binding.runtimeRoot}/${path}`, text);
  for (const [path, text] of Object.entries(source))
    await box.box.write(
      `project/${box.binding.runtimeRoot}/distribution/${path}`,
      text,
    );
  const registration = generatedRegistration(
    "claude",
    box.box.path(`project/${box.binding.runtimeRoot}`),
    "project",
    box.root,
  );
  await box.box.write(
    "project/.claude/settings.json",
    JSON.stringify(registration),
  );
  await box.box.write(
    "project/.vouch/installations/claude.json",
    JSON.stringify({
      v: 1,
      harness: "claude",
      ...box.binding,
      owned: [
        ...activationOwned,
        {
          path: ".claude/settings.json",
          kind: "hooks",
          content: JSON.stringify(registration),
          previous: null,
        },
      ],
    }),
  );
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  const duplicate = ports(box.root, ["guard", "user"]);
  await launch(box.entry, duplicate.hooks);
  t.assert.equal(duplicate.seen.calls.length, 0);
  for (const root of [box.box.root, box.root]) {
    const display = ports(root, ["statusline", "user"], {
      status: 0,
      stdout: "selected status\n",
      stderr: "",
    });
    await launch(box.entry, display.hooks);
    t.assert.equal(display.seen.code, 0);
    t.assert.equal(display.seen.stderr, "");
    t.assert.equal(
      display.seen.stdout,
      root === box.root ? "selected status\n" : "",
    );
    if (root === box.root)
      t.assert.equal(
        display.seen.calls[0]?.[0],
        join(box.runtime, "hooks/vouch-statusline.mjs"),
      );
  }
  box.binding.digest = "b".repeat(64);
  box.binding.runtimeRoot = `.vouch/versions/${box.binding.digest}/claude`;
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  const pinned = ports(box.root, ["statusline", "user"]);
  await launch(box.entry, pinned.hooks);
  t.assert.equal(pinned.seen.calls.length, 0);
  t.assert.match(pinned.seen.stderr, /VOUCH-LAUNCH/);
  const absent = ports(box.root, ["statusline", "user"]);
  await box.box.write(
    "project/vouch/config.json",
    JSON.stringify({ v: 1, harnesses: {} }),
  );
  await launch(box.entry, absent.hooks);
  t.assert.equal(absent.seen.calls.length, 0);
  t.assert.equal(absent.seen.stderr, "");
});
