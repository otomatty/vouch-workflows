import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { checkFixture, sandbox, sessionFor } from "./runtime.mjs";

/** HOOK-13 load (docs/development/hook-startup.md): CPU count - 1 background processes, at least one, keep starting no-op hooks through runHook. Resolves once each has finished one. Callers stop it in `finally`, before the sandboxes of the test are removed. */
export async function cpuLoad(
  t: import("node:test").TestContext,
): Promise<{ workers: number; readyMs: number; stop: () => Promise<void> }> {
  const started = performance.now();
  const box = await sandbox(t);
  const signal = box.path("stop");
  const fixture = sessionFor(box.root);
  checkFixture(fixture);
  const prepared = JSON.stringify({
    harness: fixture.harness,
    payload: fixture.payload,
  });
  const workers = Array.from(
    { length: Math.max(1, availableParallelism() - 1) },
    () =>
      spawn(
        process.execPath,
        [
          `--import=${pathToFileURL(resolve("tests/helpers/no-network.mjs")).href}`,
          resolve("tests/helpers/load-worker.mjs"),
          box.root,
          signal,
          prepared,
        ],
        { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
      ),
  );
  const exited = workers.map(
    (worker) => new Promise((done) => worker.once("exit", done)),
  );
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= writeFile(signal, "")
      .then(() => Promise.all(exited))
      .then(() => undefined));
  try {
    await Promise.all(
      workers.map(
        (worker, index) =>
          new Promise((ready, fail) => {
            worker.stdout.once("data", ready);
            exited[index]?.then(() =>
              fail(
                new Error("TEST-12: load process ended before its first hook"),
              ),
            );
          }),
      ),
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    workers: workers.length,
    readyMs: performance.now() - started,
    stop,
  };
}
