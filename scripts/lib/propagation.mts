export type PropagationCase = import("../native-contracts.mjs").PropagationCase;
export type PropagationObservation =
  import("../native-contracts.mjs").PropagationObservation;

/** Cases run against an installed registration; `no-root` applies to Codex only. */
export function propagationCases(
  harness: "claude" | "codex",
): PropagationCase[] {
  const cases: PropagationCase[] = [
    "allow",
    "open",
    "invalid",
    "corrupt",
    "no-intent",
  ];
  return harness === "codex" ? [...cases, "no-root"] : cases;
}

const expectedTypes: Record<PropagationCase, string[]> = {
  allow: ["session.started"],
  open: ["session.started", "gate.opened"],
  invalid: ["session.started"],
  corrupt: [],
  "no-intent": [],
  "no-root": [],
};
const reasons: Partial<Record<PropagationCase, string>> = {
  open: "VOUCH-REVIEW-RECORDED",
  invalid: "VOUCH-REVIEW-COMMAND",
};

/** An observed CLI run is not human consent or a model evaluation. @returns Failed expectation IDs; empty when the case passes or only records an observation. */
export function verifyPropagation(
  observation: PropagationObservation,
): string[] {
  if (observation.case === "no-root") return [];
  const errors = [];
  const reason = reasons[observation.case];
  const types = observation.events.map((row) =>
    row && typeof row === "object" && "type" in row ? row.type : null,
  );
  if (JSON.stringify(types) !== JSON.stringify(expectedTypes[observation.case]))
    errors.push("PROPAGATION-EVENTS");
  if (
    observation.events.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        !("harness" in row) ||
        row.harness !== observation.harness,
    )
  )
    errors.push("PROPAGATION-HARNESS");
  if (
    reason ? observation.promptRequests !== 0 : observation.promptRequests < 1
  )
    errors.push("PROPAGATION-PROVIDER");
  if (reason && !observation.output.includes(reason))
    errors.push("PROPAGATION-REASON");
  if (!reason && !observation.interactive && observation.exitCode !== 0)
    errors.push("PROPAGATION-EXIT");
  if (
    (observation.case === "corrupt" && !observation.auditUnchanged) ||
    (observation.case === "no-intent" && observation.auditExists)
  )
    errors.push("PROPAGATION-AUDIT");
  return errors;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("\n");
}

/** Counts conversation turns that carry the prompt; health checks and system threads do not. */
export function promptCarried(
  harness: "claude" | "codex",
  url: string,
  body: string,
  prompt: string,
): boolean {
  let value: {
    messages?: unknown;
    input?: unknown;
    client_metadata?: Record<string, string | undefined>;
  } | null;
  try {
    value = JSON.parse(body);
  } catch {
    return false;
  }
  if (!value || typeof value !== "object") return false;
  if (harness === "claude")
    return (
      /^\/v1\/messages(?:\?|$)/.test(url) &&
      Array.isArray(value.messages) &&
      value.messages.some(
        (message: { role?: unknown; content?: unknown }) =>
          message?.role === "user" && textOf(message.content).includes(prompt),
      )
    );
  let turn: { thread_source?: unknown } | null;
  try {
    turn = JSON.parse(value.client_metadata?.["x-codex-turn-metadata"] ?? "");
  } catch {
    return false;
  }
  return (
    url.endsWith("/responses") &&
    turn?.thread_source === "user" &&
    Array.isArray(value.input) &&
    value.input.some(
      (item: { type?: unknown; role?: unknown; content?: unknown }) =>
        item?.type === "message" &&
        item.role === "user" &&
        textOf(item.content).includes(prompt),
    )
  );
}

const escapeCode = String.fromCharCode(27);
const bellCode = String.fromCharCode(7);
const sequences = [
  new RegExp(
    `${escapeCode}\\][^${bellCode}${escapeCode}]*(?:${bellCode}|${escapeCode}\\\\)`,
    "g",
  ),
  new RegExp(`${escapeCode}\\[[0-?]*[ -/]*[@-~]`, "g"),
  new RegExp(`${escapeCode}[@-_]`, "g"),
];

/** Terminal logs without control sequences, with CR line ends as LF. */
export function stripTerminal(text: string): string {
  return sequences
    .reduce((result, pattern) => result.replace(pattern, ""), text)
    .replace(/\r\n?/g, "\n");
}
