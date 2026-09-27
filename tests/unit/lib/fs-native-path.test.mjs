import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { sandbox } from "../../helpers/runtime.mjs";

test("native updates complete and release their lock beneath a Japanese path", async (t) => {
  const box = await sandbox(t, { git: false });
  const root = box.path("日本語 project $ apostrophe'");
  await fs.mkdir(root);
  const module = pathToFileURL(resolve("core/hooks/lib/fs.mjs")).href;
  // A native crash must fail this assertion without aborting the parent test runner.
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      String.raw`
    import {createFileStore} from ${JSON.stringify(module)};
    const files = await createFileStore(process.argv[1]);
    await files.writeText("nested/監査.jsonl", "日本語\n");
    await files.updateText("nested/監査.jsonl", text => text + "追加\n");
    process.stdout.write(await files.readText("nested/監査.jsonl"));
  `,
      root,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 4000 },
  );
  t.plan(4);
  t.assert.equal(result.error, undefined);
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.equal(result.stdout, "日本語\n追加\n");
  t.assert.deepEqual(await fs.readdir(resolve(root, "nested")), ["監査.jsonl"]);
});
