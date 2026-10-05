// Design D8 (docs/development/distribution-scope-review.md): Vouch never parses and
// rewrites a user's TOML. It creates the file, appends a marked block for tables that
// are defined nowhere, or stops with the lines to add. Lines are matched one by one;
// table-like lines inside multi-line strings are a documented limitation.

const required = [
  {
    table: "features",
    line: "hooks = true",
    key: /^\s*hooks\s*=\s*true\s*(?:#.*)?$/,
  },
  {
    table: "agents",
    line: "max_depth = 1",
    key: /^\s*max_depth\s*=\s*[1-9][0-9]*\s*(?:#.*)?$/,
  },
];
const quoted = (table: string) => `(?:${table}|"${table}"|'${table}')`;
const header = /^\s*\[/;

export type CodexChange =
  | { kind: "file"; content: string }
  | { kind: "block"; content: string }
  | { kind: "none" };

export function codexConfig(text: string | null): CodexChange {
  const body = (tables: typeof required) =>
    tables.map(({ table, line }) => `[${table}]\n${line}\n`).join("\n");
  if (text === null) return { kind: "file", content: body(required) };
  const lines = text.split(/\r?\n/);
  const missing: typeof required = [];
  for (const setting of required) {
    const exact = new RegExp(
      `^\\s*\\[\\s*${quoted(setting.table)}\\s*\\]\\s*(?:#.*)?$`,
    );
    const start = lines.findIndex((line) => exact.test(line));
    const next = lines.findIndex((line, i) => i > start && header.test(line));
    const satisfied =
      start >= 0 &&
      lines
        .slice(start + 1, next < 0 ? lines.length : next)
        .some((line) => setting.key.test(line));
    if (satisfied) continue;
    // Any other spelling of the table (subtable, array table, dotted or inline key) is the user's.
    const defined = new RegExp(
      `^\\s*(?:\\[\\[?\\s*${quoted(setting.table)}\\s*[\\].]|${quoted(setting.table)}\\s*[.=])`,
    );
    if (lines.some((line) => defined.test(line)))
      throw new Error(
        `INSTALL-CONFIG: add "${setting.line}" under [${setting.table}] in .codex/config.toml; Vouch does not edit tables you define`,
      );
    missing.push(setting);
  }
  if (missing.length === 0) return { kind: "none" };
  return {
    kind: "block",
    content: `${text.endsWith("\n") || text === "" ? "" : "\n"}\n# vouch:codex:start\n${body(missing)}# vouch:codex:end\n`,
  };
}
