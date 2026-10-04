import { test } from "node:test";
import { readSecrets } from "../../core/hooks/lib/env.mjs";
import { isAuditEvent } from "../../core/hooks/lib/validation.mjs";
import { readJson, validator } from "../helpers/registry.mjs";

// docs/development/git-guard.md: commit grammar, protected branches, test paths and DoD records.
test("the build registry has a closed schema", (t) => {
  const valid = validator("build");
  const registry = readJson("core/registry/build.json");
  const cases = [
    { ...registry, extra: true },
    { ...registry, protected: [] },
    { ...registry, protected: ["-main"] },
    { ...registry, commits: { ...registry.commits, tests: "spec" } },
    { ...registry, commits: { ...registry.commits, types: ["Feat"] } },
    {
      ...registry,
      commits: { ...registry.commits, requires: { feat: ["test"], fix: [] } },
    },
    {
      ...registry,
      commits: {
        ...registry.commits,
        evidence: { contract: "fail", test: "pass" },
      },
    },
    { ...registry, tests: { ...registry.tests, names: [] } },
    { ...registry, dod: { section: "done", outputLines: 200 } },
    { ...registry, dod: { section: "dod", outputLines: 0 } },
  ];
  t.plan(cases.length + 1);
  t.assert.equal(valid(registry), true);
  for (const value of cases) t.assert.equal(valid(value), false);
});

test("commit types, requirements, protected branches and DoD section agree with the other registries", (t) => {
  const build = readJson("core/registry/build.json");
  const documents = readJson("core/registry/project-documents.json");
  const names = [
    ...Object.keys(build.commits.requires),
    ...Object.values(build.commits.requires).flat(),
    ...Object.keys(build.commits.evidence),
    build.commits.tests,
  ];
  t.plan(4 + build.tests.names.length);
  t.assert.equal(
    names.every((name: string) => build.commits.types.includes(name)),
    true,
  );
  t.assert.equal(build.protected.includes("main"), true);
  t.assert.equal(documents.rules_sections.includes(build.dod.section), true);
  t.assert.equal(Object.hasOwn(documents.artifacts, "build"), true);
  for (const pattern of build.tests.names)
    t.assert.doesNotThrow(() => new RegExp(pattern));
});

/** A DoD record as the command writes it. */
const record = {
  id: "evt_dod",
  v: 1,
  type: "hook.check",
  ts: "2026-09-29T00:00:00.000Z",
  actor: "hook",
  intent: "260929-orders",
  stage: "build",
  check: "dod",
  result: "fail",
  duration_ms: 12,
  missing: 0,
  commit: "a".repeat(40),
  clean: true,
  commands: [
    {
      target: "Unit tests",
      command: "npm test",
      cwd: ".",
      result: "fail",
      duration_ms: 10,
      exit_code: 1,
    },
  ],
  output: { path: "build-log.md", sha256: "b".repeat(64) },
};

test("DoD records agree in Ajv and the runtime validator for complete and malformed shapes", (t) => {
  const validate = validator("audit-event");
  const [command] = record.commands;
  const without = (key: string) => {
    const value = { ...record };
    Reflect.deleteProperty(value, key);
    return value;
  };
  const { exit_code: _exit, ...unran } = command as typeof command & {
    exit_code?: number;
  };
  const cases = [
    [record, true],
    [without("commit"), true],
    [{ ...record, commit: "a".repeat(64) }, true],
    [{ ...record, commands: [], result: "fail" }, true],
    [{ ...record, commands: [unran] }, true],
    [without("clean"), false],
    [without("output"), false],
    [{ ...without("commands") }, false],
    [{ ...record, check: "contract" }, false],
    [{ ...record, commit: "A".repeat(40) }, false],
    [{ ...record, commit: `${"a".repeat(40)}\n` }, false],
    [{ ...record, commit: "a".repeat(41) }, false],
    [
      { ...record, output: { path: "review.md", sha256: "b".repeat(64) } },
      false,
    ],
    [{ ...record, output: { ...record.output, extra: 1 } }, false],
    [{ ...record, commands: [{ ...command, command: "" }] }, false],
    [{ ...record, commands: [{ ...command, result: "error" }] }, false],
    [{ ...record, commands: [{ ...command, exit_code: 1.5 }] }, false],
    [{ ...record, commands: [{ ...command, extra: true }] }, false],
    [{ ...record, commands: [without("target")] }, false],
    [
      {
        id: "evt_plain",
        v: 1,
        type: "hook.check",
        ts: record.ts,
        actor: "hook",
        check: "citation",
        result: "pass",
        duration_ms: 1,
      },
      true,
    ],
    [
      {
        id: "evt_orphan",
        v: 1,
        type: "hook.check",
        ts: record.ts,
        actor: "hook",
        check: "dod",
        result: "pass",
        duration_ms: 1,
        clean: true,
      },
      false,
    ],
  ];
  t.plan(cases.length * 2);
  for (const [value, expected] of cases) {
    t.assert.equal(validate(value), expected, JSON.stringify(value));
    t.assert.equal(isAuditEvent(value), expected, JSON.stringify(value));
  }
});

test("the manual report schema accepts DoD check IDs beside doctor IDs", (t) => {
  const valid = validator("doctor-report");
  const report = (id: string) => ({
    v: 1,
    ok: false,
    checks: [{ id, ok: false, detail: "x" }],
  });
  t.plan(5);
  for (const id of ["DOCTOR-NODE", "DOD-COMMAND", "DOD-RECORD"])
    t.assert.equal(valid(report(id)), true, id);
  for (const id of ["DOD-", "TEST-COMMAND"])
    t.assert.equal(valid(report(id)), false, id);
});

test("the DoD redaction names cover token, key and auth variables but not author names", (t) => {
  const { redact } = readJson("core/registry/build.json").dod;
  const value = (name: string) => `${name.toLowerCase()}-value`;
  const secret = [
    "GITHUB_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "DB_PASSWORD",
    "OPENAI_API_KEY",
    "DOCKER_AUTH_CONFIG",
    "NPM_CONFIG__AUTH",
    "AUTH_HEADER",
  ];
  const plain = [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "AUTHORIZED_USERS",
    "PATH",
  ];
  const found = readSecrets(
    redact,
    Object.fromEntries(
      [...secret, ...plain].map((name) => [name, value(name)]),
    ),
  );
  t.plan(1);
  t.assert.deepEqual(found.sort(), secret.map(value).sort());
});
