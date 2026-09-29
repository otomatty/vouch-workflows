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

/**
 * @typedef {import('./runtime-contracts.mjs').ShellCommand} ShellCommand
 * @typedef {{into:ShellCommand,delimiter:string,strip:boolean}} HereDocument
 */

/** Here-document lines become words of their command; returns the index after them.
 * @param {string} text @param {number} start @param {HereDocument[]} documents */
function bodies(text, start, documents) {
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

/** @type {import('./runtime-contracts.mjs').ParseShell} */
export function parseShell(text) {
  /** @type {ShellCommand[]} */ const commands = [];
  /** @type {HereDocument[]} */ const documents = [];
  /** @returns {ShellCommand} */
  const blank = () => ({ words: [], expands: [], writes: false, depth: 0 });
  let current = blank();
  /** @type {string|null} */ let word = null;
  let expands = false;
  /** @type {''|'write'|'dup'|'dup-write'|'document'|'document-strip'} */
  let target = "";
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
    const c = /** @type {string} */ (text[i]);
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
        const d = /** @type {string} */ (text[i]);
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
      const op = /** @type {string} */ (
        operators.find((item) => text.startsWith(item, i))
      );
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
}

/** @param {string} arg @param {string[]} options Short options also match inside a bundle. */
function refuses(arg, options) {
  return options.some(
    (option) =>
      arg === option ||
      arg.startsWith(`${option}=`) ||
      (/^-[^-]$/.test(option) &&
        /^-[^-]/.test(arg) &&
        arg.includes(option.slice(1))),
  );
}

/** Only `-n` with line-range print scripts. @param {string[]} args */
function sedPrints(args) {
  let quiet = false;
  /** @type {string|undefined} */ let script;
  for (let i = 0; i < args.length; i++) {
    const arg = /** @type {string} */ (args[i]);
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

/** Allowed global options, then a subcommand that leaves worktree files alone. @param {string[]} args */
function gitReads(args) {
  let i = 0;
  while (args[i]?.startsWith("-")) {
    if (args[i] === "-C") i += 2;
    else if (guard.shell.git.globals.includes(/** @type {string} */ (args[i])))
      i++;
    else return false;
  }
  return guard.shell.git.commands.includes(args[i] ?? "");
}

/** The program and its arguments after leading reserved words and assignments.
 * @param {ShellCommand} command @returns {string[]} */
export function programOf(command) {
  let start = 0;
  for (const word of command.words) {
    if (!keywords.has(word) && !/^[A-Za-z_]\w*=/.test(word)) break;
    start++;
  }
  return command.words.slice(start);
}

/** @type {import('./runtime-contracts.mjs').ReadsOnly} */
export function readsOnly(command, doctor) {
  if (command.writes) return false;
  let start = 0;
  while (keywords.has(command.words[start] ?? "")) start++;
  const [program, ...args] = command.words.slice(start);
  if (program === undefined) return true;
  // Readers are bare names, so a path, a leading assignment or an expansion never matches.
  if (!guard.shell.readers.includes(program)) return false;
  if (strict.has(program) && command.expands.slice(start + 1).some(Boolean))
    return false;
  /** @type {Record<string,string[]>} */ const refused = guard.shell.refused;
  const options = Object.hasOwn(refused, program) ? refused[program] : [];
  if (args.some((arg) => refuses(arg, /** @type {string[]} */ (options))))
    return false;
  if (program === "sed") return sedPrints(args);
  if (program === "git") return gitReads(args);
  if (program === "node")
    return args.length === 1 && doctor(/** @type {string} */ (args[0]));
  return true;
}
