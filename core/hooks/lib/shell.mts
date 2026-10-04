import runtime from "../../registry/runtime.json" with { type: "json" };
import guard from "../../registry/write-guard.json" with { type: "json" };

/** Leading reserved words and group braces; they are not programs. */
const keywords = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
]);
/** Programs whose options can write, so expanded arguments may smuggle one in. */
const strict = new Set(["file", "find", "git", "rg", "sed", "sort"]);
const operators = [
  "&>>",
  "<<<",
  "<<-",
  ">>",
  ">|",
  ">&",
  "&>",
  "<<",
  "<>",
  "<&",
  ">",
  "<",
];

export type ShellCommand = import("./runtime-contracts.mjs").ShellCommand;
export type HereDocument = {
  into: ShellCommand;
  delimiter: string;
  strip: boolean;
};

/** Here-document lines become words of their command; returns the index after them. */
function bodies(text: string, start: number, documents: HereDocument[]) {
  for (const document of documents) {
    while (start < text.length) {
      const newline = text.indexOf("\n", start);
      const stop = newline < 0 ? text.length : newline;
      let line = text.slice(start, stop).replace(/\r$/, "");
      if (document.strip) line = line.replace(/^\t+/, "");
      start = stop + 1;
      if (line === document.delimiter) break;
      for (const piece of line.split(/\s+/).filter(Boolean)) {
        document.into.words.push(piece);
        document.into.expands.push(false);
      }
    }
  }
  return start;
}

export const parseShell: import("./runtime-contracts.mjs").ParseShell = (
  text,
) => {
  const commands: ShellCommand[] = [];
  const documents: HereDocument[] = [];
  const blank = (): ShellCommand => ({
    words: [],
    expands: [],
    writes: false,
    depth: 0,
  });
  let current = blank();
  let word: string | null = null;
  let expands = false;
  let target:
    | ""
    | "write"
    | "dup"
    | "dup-write"
    | "document"
    | "document-strip" = "";
  let depth = 0;
  let dynamic = false;
  let ticks = false;
  const flush = () => {
    if (word === null) return;
    const value = word;
    const kind = target;
    word = null;
    target = "";
    if (kind === "document" || kind === "document-strip") {
      documents.push({
        into: current,
        delimiter: value,
        strip: kind === "document-strip",
      });
    } else if (!(kind.startsWith("dup") && /^(?:\d+|-)$/.test(value))) {
      if (kind === "write" || kind === "dup-write")
        current.writes ||= value !== "/dev/null";
      current.words.push(value);
      current.expands.push(expands);
    }
    expands = false;
  };
  const end = () => {
    flush();
    const pending = documents.some((document) => document.into === current);
    if (current.words.length > 0 || current.writes || pending) {
      current.depth = depth;
      commands.push(current);
    }
    current = blank();
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    const next = text[i + 1];
    if (c === "\\") {
      if (next !== "\n") word = (word ?? "") + (next ?? "");
      i++;
    } else if (c === "'") {
      const close = text.indexOf("'", i + 1);
      const stop = close < 0 ? text.length : close;
      word = (word ?? "") + text.slice(i + 1, stop);
      i = stop;
    } else if (c === '"') {
      let value = "";
      for (i++; i < text.length && text[i] !== '"'; i++) {
        const d = text[i] as string;
        if (d === "\\" && '"\\$`\n'.includes(text[i + 1] ?? "x")) {
          if (text[++i] !== "\n") value += text[i];
          continue;
        }
        if (d === "$" || d === "`") {
          expands = true;
          dynamic ||= d === "`" || text[i + 1] === "(";
        }
        value += d;
      }
      word = (word ?? "") + value;
    } else if (c === "#" && word === null) {
      const newline = text.indexOf("\n", i);
      i = (newline < 0 ? text.length : newline) - 1;
    } else if (c === "\n") {
      end();
      i = bodies(text, i + 1, documents.splice(0)) - 1;
    } else if (c === " " || c === "\t" || c === "\r") {
      flush();
    } else if ((c === "$" || c === "<" || c === ">") && next === "(") {
      end();
      dynamic = true;
      depth++;
      i++;
    } else if (c === "`") {
      end();
      dynamic = true;
      depth += ticks ? -1 : 1;
      ticks = !ticks;
    } else if (c === "(" || c === ")") {
      end();
      depth = c === "(" ? depth + 1 : Math.max(0, depth - 1);
    } else if (c === ";" || c === "|" || (c === "&" && next !== ">")) {
      // A doubled operator such as && or || only ends another, empty command.
      end();
    } else if (c === "<" || c === ">" || c === "&") {
      if (word !== null && /^\d+$/.test(word)) {
        word = null;
        expands = false;
      } else flush();
      const op = operators.find((item) => text.startsWith(item, i)) as string;
      i += op.length - 1;
      target =
        op === "<<"
          ? "document"
          : op === "<<-"
            ? "document-strip"
            : op === ">&"
              ? "dup-write"
              : op === "<&"
                ? "dup"
                : op === "<" || op === "<<<"
                  ? ""
                  : "write";
    } else {
      if ("*?[${".includes(c) || (c === "~" && word === null)) expands = true;
      word = (word ?? "") + c;
    }
  }
  end();
  return { commands, dynamic };
};

/** @param options Short options also match inside a bundle. */
function refuses(arg: string, options: string[]) {
  return options.some(
    (option) =>
      arg === option ||
      arg.startsWith(`${option}=`) ||
      (/^-[^-]$/.test(option) &&
        /^-[^-]/.test(arg) &&
        arg.includes(option.slice(1))),
  );
}

/** Only `-n` with line-range print scripts. */
function sedPrints(args: string[]) {
  let quiet = false;
  let script: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (["-n", "--quiet", "--silent"].includes(arg)) quiet = true;
    else if (arg === "-e" && script === undefined) script = args[++i] ?? "";
    else if (arg.startsWith("-") && arg !== "-E" && arg !== "-r") return false;
    else if (script === undefined && !arg.startsWith("-")) script = arg;
  }
  return (
    quiet &&
    script !== undefined &&
    /^(?:(?:\d+|\$)(?:,(?:\d+|\$))?p;?)+$/.test(script)
  );
}

/** Allowed global options, then a subcommand that leaves worktree files alone. */
function gitReads(args: string[]) {
  let i = 0;
  while (args[i]?.startsWith("-")) {
    if (args[i] === "-C") i += 2;
    else if (guard.shell.git.globals.includes(args[i] as string)) i++;
    else return false;
  }
  return guard.shell.git.commands.includes(args[i] ?? "");
}

/** The program and its arguments after leading reserved words and assignments. */
export function programOf(command: ShellCommand): string[] {
  let start = 0;
  for (const word of command.words) {
    if (!keywords.has(word) && !/^[A-Za-z_]\w*=/.test(word)) break;
    start++;
  }
  return command.words.slice(start);
}

export const readsOnly: import("./runtime-contracts.mjs").ReadsOnly = (
  command,
  doctor,
) => {
  if (command.writes) return false;
  let start = 0;
  while (keywords.has(command.words[start] ?? "")) start++;
  const [program, ...args] = command.words.slice(start);
  if (program === undefined) return true;
  // Readers are bare names, so a path, a leading assignment or an expansion never matches.
  if (!guard.shell.readers.includes(program)) return false;
  if (strict.has(program) && command.expands.slice(start + 1).some(Boolean))
    return false;
  const refused: Record<string, string[]> = guard.shell.refused;
  const options = Object.hasOwn(refused, program) ? refused[program] : [];
  if (args.some((arg) => refuses(arg, options as string[]))) return false;
  if (program === "sed") return sedPrints(args);
  if (program === "git") return gitReads(args);
  // A registered command entry may take literal word arguments, such as `ask Q-1`; nothing the
  // shell would expand counts, whatever the word looks like after quote removal.
  if (program === "node")
    return (
      doctor(args[0] ?? "") &&
      (!(args[0] ?? "").endsWith("vouch-launch.mjs") ||
        (args[2] === "manual" &&
          runtime.commands.some(
            (name) =>
              name !== "vouch-launch.mjs" && name === `vouch-${args[1]}.mjs`,
          ))) &&
      !command.expands.slice(start + 1).some(Boolean) &&
      args.slice(1).every((arg) => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(arg))
    );
  return true;
};
