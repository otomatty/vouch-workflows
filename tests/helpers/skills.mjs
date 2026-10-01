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

/** DOC-3: a Skill fence may run a registered Node entry, with plain word or placeholder
 * arguments, or a registered git subcommand.
 * @param {string} line @param {{commands:string[],git:string[],protected:string[]}} allowed */
export function allowedCommand(line, allowed) {
  const node =
    /^node "\{\{HARNESS_DIR\}\}\/hooks\/(vouch-[a-z-]+\.mjs)"(?: (?:[a-z]+|<[^<>"'`$;&|\s]+>))*$/.exec(
      line,
    );
  if (node) return allowed.commands.includes(node[1] ?? "");
  const git = /^git ([a-z-]+)(?: |$)/.exec(line);
  if (!git?.[1] || !allowed.git.includes(git[1])) return false;
  if (/[;&|`$]|[<>]\s*\(|\b(?:bun|npx|curl|gh)\b/.test(line)) return false;
  const words = line.split(/\s+/);
  return !(
    git[1] === "push" &&
    words.some(
      (word) =>
        word.startsWith("+") ||
        /^(?:-f|--force(?:-with-lease)?(?:=.*)?|--mirror|--all)$/.test(word) ||
        word
          .split(":")
          .some((ref) =>
            allowed.protected.includes(ref.replace(/^refs\/heads\//, "")),
          ),
    )
  );
}
