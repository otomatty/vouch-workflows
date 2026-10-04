import { test } from "node:test";
import {
  promptCarried,
  propagationCases,
  stripTerminal,
  verifyPropagation,
} from "../../scripts/lib/propagation.mjs";
import observed from "../fixtures/native/hook-propagation-linux.json" with {
  type: "json",
};

export type Observation =
  import("../../scripts/native-contracts.mjs").PropagationObservation;

// Codex 0.153.4 exec blocks the prompt but prints only "hook: UserPromptSubmit Blocked",
// also with --json; the hook's stderr reason is not shown. Pinned so a change is noticed.
const knownMismatches = [
  "codex:false:open:PROPAGATION-REASON",
  "codex:false:invalid:PROPAGATION-REASON",
];

test("saved Linux observations meet the installed propagation expectations", (t) => {
  t.plan(6 + observed.runs.length);
  t.assert.deepEqual(
    [
      observed.kind,
      observed.scripted,
      observed.humanApproval,
      observed.modelEvaluation,
    ],
    ["native-cli-observation", true, false, false],
  );
  t.assert.deepEqual(
    observed.runs.map((run) => `${run.harness}:${run.interactive}`).sort(),
    ["claude:false", "claude:true", "codex:false", "codex:true"],
    "each harness is exercised interactively and non-interactively",
  );
  t.assert.equal(
    observed.runs.every((run) => run.platform === "linux"),
    true,
  );
  t.assert.equal(
    observed.runs.every((run) =>
      run.observations.every(
        (item) =>
          item.harness === run.harness && item.interactive === run.interactive,
      ),
    ),
    true,
  );
  t.assert.deepEqual(
    observed.runs.flatMap((run) =>
      run.observations.flatMap((item) =>
        verifyPropagation(item as Observation).map(
          (error) => `${run.harness}:${run.interactive}:${item.case}:${error}`,
        ),
      ),
    ),
    knownMismatches,
    "only the pinned Codex exec reason display differs",
  );
  t.assert.deepEqual(
    observed.runs.flatMap((run) =>
      run.errors.map((error) => `${run.harness}:${run.interactive}:${error}`),
    ),
    knownMismatches,
    "the check reported the same result when it ran",
  );
  for (const run of observed.runs)
    t.assert.deepEqual(
      run.observations.map((item) => item.case),
      propagationCases(run.harness as "claude" | "codex"),
    );
});

const event = (type: string, harness: string = "claude") => ({ type, harness });
const allow: Observation = {
  case: "allow",
  harness: "claude",
  interactive: false,
  exitCode: 0,
  promptRequests: 1,
  events: [event("session.started")],
  auditExists: true,
  auditUnchanged: true,
  output: "",
};
const open: Observation = {
  ...allow,
  case: "open",
  promptRequests: 0,
  events: [event("session.started"), event("gate.opened")],
  output: "VOUCH-REVIEW-RECORDED: evt_x; draft review opened",
};

test("propagation verification names each broken expectation", (t) => {
  const cases: [Observation, string[]][] = [
    [allow, []],
    [{ ...allow, interactive: true, exitCode: null }, []],
    [{ ...allow, exitCode: 1 }, ["PROPAGATION-EXIT"]],
    [{ ...allow, promptRequests: 0 }, ["PROPAGATION-PROVIDER"]],
    [{ ...allow, events: [] }, ["PROPAGATION-EVENTS"]],
    [
      { ...allow, events: [event("session.started", "codex")] },
      ["PROPAGATION-HARNESS"],
    ],
    [open, []],
    [{ ...open, exitCode: 1 }, []],
    [{ ...open, promptRequests: 1 }, ["PROPAGATION-PROVIDER"]],
    [{ ...open, output: "blocked" }, ["PROPAGATION-REASON"]],
    [{ ...open, events: [event("session.started")] }, ["PROPAGATION-EVENTS"]],
    [
      {
        ...open,
        case: "invalid",
        events: [event("session.started")],
        output: "VOUCH-REVIEW-COMMAND: exact review or approval input required",
      },
      [],
    ],
    [
      {
        ...open,
        case: "invalid",
        output: "VOUCH-REVIEW-COMMAND: exact review or approval input required",
      },
      ["PROPAGATION-EVENTS"],
    ],
    [{ ...allow, case: "corrupt", events: [] }, []],
    [
      { ...allow, case: "corrupt", events: [], auditUnchanged: false },
      ["PROPAGATION-AUDIT"],
    ],
    [{ ...allow, case: "no-intent", events: [], auditExists: false }, []],
    [
      { ...allow, case: "no-intent", events: [], auditExists: true },
      ["PROPAGATION-AUDIT"],
    ],
    [{ ...open, case: "no-root", harness: "codex", promptRequests: 3 }, []],
  ];
  t.plan(cases.length);
  for (const [observation, expected] of cases)
    t.assert.deepEqual(
      verifyPropagation(observation),
      expected,
      `${observation.case} ${JSON.stringify(observation)}`,
    );
});

test("only conversation turns carrying the prompt count as provider delivery", (t) => {
  const prompt = "vouch review";
  const codex = (source: string) =>
    JSON.stringify({
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ thread_source: source }),
      },
    });
  const claude = JSON.stringify({
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });
  t.plan(7);
  t.assert.equal(promptCarried("claude", "/api/hello", "", prompt), false);
  t.assert.equal(
    promptCarried("claude", "/v1/messages?beta=true", claude, prompt),
    true,
  );
  t.assert.equal(
    promptCarried("claude", "/v1/messages?beta=true", claude, "other"),
    false,
  );
  t.assert.equal(
    promptCarried("claude", "/v1/messages/count_tokens", claude, prompt),
    false,
  );
  t.assert.equal(
    promptCarried("codex", "/v1/responses", codex("user"), prompt),
    true,
  );
  t.assert.equal(
    promptCarried("codex", "/v1/responses", codex("system"), prompt),
    false,
  );
  t.assert.equal(promptCarried("codex", "/v1/responses", "{", prompt), false);
});

test("terminal logs are compared without escape sequences", (t) => {
  t.plan(1);
  t.assert.equal(
    stripTerminal(
      "\u001b]0;title\u0007\u001b[31mVOUCH\u001b[0m\r\nok\u001b[?25l",
    ),
    "VOUCH\nok",
  );
});
