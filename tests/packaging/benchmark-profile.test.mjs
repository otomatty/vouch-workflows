import { mkdir } from "node:fs/promises";
import { profileSummary } from "../../scripts/lib/benchmark-profile.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("profile diagnostics align each sample delta and preserve slow individual process gaps", async (t) => {
  const box = await sandbox(t, { git: false });
  await mkdir(box.path("profiles"));
  const profile = {
    startTime: 1000,
    endTime: 18000,
    nodes: [
      { id: 1, callFrame: { functionName: "(idle)", url: "" } },
      { id: 2, callFrame: { functionName: "fsyncSync", url: "" } },
      {
        id: 3,
        callFrame: {
          functionName: "record",
          url: "file:///core/hooks/lib/io.mjs",
        },
      },
    ],
    samples: [1, 2, 3],
    timeDeltas: [1000, 5000, 9000],
  };
  for (const index of [0, 1])
    await box.write(
      `profiles/sample-${index}.cpuprofile`,
      JSON.stringify(profile),
    );
  const result = profileSummary(box.path("profiles"), [
    { index: 0, ms: 50 },
    { index: 1, ms: 350 },
  ]);
  t.assert.equal(result.executions, 2);
  t.assert.equal(result.sampled_ms, 15);
  t.assert.deepEqual(result.categories, [
    { name: "hook code", ms: 9 },
    { name: "native fsyncSync", ms: 5 },
    { name: "(idle)", ms: 1 },
  ]);
  t.assert.deepEqual(
    result.runs.map(
      ({ index, wall_ms, profile_window_ms, outside_profile_ms }) => ({
        index,
        wall_ms,
        profile_window_ms,
        outside_profile_ms,
      }),
    ),
    [
      { index: 0, wall_ms: 50, profile_window_ms: 17, outside_profile_ms: 33 },
      {
        index: 1,
        wall_ms: 350,
        profile_window_ms: 17,
        outside_profile_ms: 333,
      },
    ],
  );
});

test("profile diagnostics refuse missing process profiles instead of silently dropping samples", async (t) => {
  const box = await sandbox(t, { git: false });
  await mkdir(box.path("profiles"));
  t.assert.throws(
    () => profileSummary(box.path("profiles"), [{ index: 0, ms: 50 }]),
    /sample-0\.cpuprofile/,
  );
});
