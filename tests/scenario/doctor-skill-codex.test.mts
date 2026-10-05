import { assertDoctorSkill } from "../helpers/doctor-skill.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";

test("codex Skill command diagnoses its installed project and reports missing files", async (t) => {
  t.plan(6);
  await assertDoctorSkill(t, "codex");
});
