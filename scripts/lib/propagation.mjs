/** @typedef {import('../native-contracts.mjs').PropagationCase} PropagationCase */
/** @typedef {import('../native-contracts.mjs').PropagationObservation} PropagationObservation */

/** Cases run against an installed registration; `no-root` applies to Codex only.
 * @param {'claude'|'codex'} harness @returns {PropagationCase[]} */
export function propagationCases(harness) {
  /** @type {PropagationCase[]} */
  const cases = ["allow", "open", "invalid", "corrupt", "no-intent"];
  return harness === "codex" ? [...cases, "no-root"] : cases;
}

/** @type {Record<PropagationCase,string[]>} */
const expectedTypes = {
  allow: ["session.started"],
  open: ["session.started", "gate.opened"],
  invalid: ["session.started"],
  corrupt: [],
  "no-intent": [],
  "no-root": [],
};
/** @type {Partial<Record<PropagationCase,string>>} */
const reasons = {
  open: "VOUCH-REVIEW-RECORDED",
  invalid: "VOUCH-REVIEW-COMMAND",
};

/** An observed CLI run is not human consent or a model evaluation.
 * @param {PropagationObservation} observation
 * @returns {string[]} Failed expectation IDs; empty when the case passes or only records an observation.
 */
export function verifyPropagation(observation) {
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

/** @param {unknown} content @returns {string} */
function textOf(content) {
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

/** Counts conversation turns that carry the prompt; health checks and system threads do not.
 * @param {'claude'|'codex'} harness @param {string} url @param {string} body @param {string} prompt
 * @returns {boolean} */
export function promptCarried(harness, url, body, prompt) {
  let value;
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
        (/** @type {{role?:unknown,content?:unknown}} */ message) =>
          message?.role === "user" && textOf(message.content).includes(prompt),
      )
    );
  let turn;
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
      (/** @type {{type?:unknown,role?:unknown,content?:unknown}} */ item) =>
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

/** Terminal logs without control sequences, with CR line ends as LF.
 * @param {string} text @returns {string} */
export function stripTerminal(text) {
  return sequences
    .reduce((result, pattern) => result.replace(pattern, ""), text)
    .replace(/\r\n?/g, "\n");
}
