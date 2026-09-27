/** Restricted flat YAML for the current scalar Skill schema, not a general parser.
 * @param {string} text @returns {Record<string,unknown>}
 */
export function frontmatter(text) {
  const header = /^---\n([\s\S]*?)\n---\n/.exec(text.replaceAll("\r\n", "\n"));
  if (!header?.[1]) throw new Error("DOC-1: missing frontmatter");
  /** @type {Record<string,unknown>} */ const fields = {};
  for (const line of header[1].split("\n")) {
    const match = /^([a-z-]+): (.+)$/.exec(line);
    if (!match?.[1] || !match[2] || Object.hasOwn(fields, match[1]))
      throw new Error("DOC-1: unsupported or duplicate frontmatter field");
    const value = match[2];
    if (value.startsWith('"') || /^(true|false)$/.test(value))
      fields[match[1]] = JSON.parse(value);
    else if (/^[a-z][a-z0-9-]*$/.test(value)) fields[match[1]] = value;
    else throw new Error("DOC-1: unsupported scalar");
  }
  return fields;
}

/** @param {string} text @returns {string[]} */
export function commands(text) {
  return [...text.matchAll(/```(?:sh|shell|powershell)\r?\n([\s\S]*?)```/g)]
    .flatMap((match) => (match[1] ?? "").trim().split(/\r?\n/))
    .filter(Boolean);
}

/** @param {string} text */
export function doctorCommand(text) {
  const lines = commands(text);
  const match = /^node "(\.[a-z]+\/hooks\/vouch-doctor\.mjs)"$/.exec(
    lines[0] ?? "",
  );
  if (lines.length !== 1 || !match?.[1])
    throw new Error("DOC-3: invalid doctor command");
  return { command: lines[0] ?? "", entry: match[1] };
}
