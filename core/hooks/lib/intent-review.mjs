import commands from "../../registry/intent-review.json" with { type: "json" };

/** @type {import('./runtime-contracts.mjs').ParseIntentReviewCommand} */
export function parseIntentReviewCommand(prompt) {
  if (prompt === commands.open) return { kind: "open" };
  if (prompt.startsWith(commands.approvePrefix)) {
    const gate = prompt.slice(commands.approvePrefix.length);
    return new RegExp(commands.gatePattern).test(gate)
      ? { kind: "approve", gate }
      : { kind: "invalid" };
  }
  const words = [commands.open, commands.approvePrefix.trimEnd()];
  return words.some(
    (word) =>
      prompt === word ||
      (prompt.startsWith(word) && /^\s/.test(prompt.slice(word.length))),
  )
    ? { kind: "invalid" }
    : null;
}
