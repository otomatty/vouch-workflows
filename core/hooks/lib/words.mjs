// Shell word expansion/comments and single-line TOML value tokens.

/** A `{x..y}` body: letters in order, or an integer sequence by its first value. @param {string} body */
function sequence(body) {
  if (/^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(body)) return [body.split("..")[0]];
  const [, from, to, by] =
    /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/.exec(body) ?? [];
  if (!from || !to) return null;
  const [start, end] = [from.charCodeAt(0), to.charCodeAt(0)];
  const step = (Math.abs(Number(by ?? 1)) || 1) * (start <= end ? 1 : -1);
  /** @type {string[]} */ const letters = [];
  for (let c = start; (end - c) * step >= 0; c += step)
    letters.push(String.fromCharCode(c));
  return letters;
}

/** @type {import('./runtime-contracts.mjs').ExpandBraces} */
export function expandBraces(word) {
  /** @type {string[]} */ const out = [];
  /** @param {string} text @returns {boolean} */
  const expand = (text) => {
    // Like bash, the first `{` that opens a valid expression expands, then each result again.
    for (let at = text.indexOf("{"); at >= 0; at = text.indexOf("{", at + 1)) {
      const cuts = [at];
      let close = -1;
      for (let i = at, depth = 0; close < 0 && i < text.length; i++) {
        const c = text[i];
        if (c === "," && depth === 1) cuts.push(i);
        depth += c === "{" ? 1 : c === "}" ? -1 : 0;
        if (depth === 0) close = i;
      }
      if (close < 0) continue;
      const choices =
        cuts.length > 1
          ? [...cuts.slice(1), close].map((cut, k) =>
              text.slice(/** @type {number} */ (cuts[k]) + 1, cut),
            )
          : sequence(text.slice(at + 1, close));
      if (choices) {
        const [before, after] = [text.slice(0, at), text.slice(close + 1)];
        return choices.every((choice) => expand(before + choice + after));
      }
    }
    out.push(text);
    return out.length <= 256;
  };
  return expand(word) ? out : null;
}

/** @type {import('./runtime-contracts.mjs').Uncommented} */
export function uncommented(text) {
  let kept = "";
  for (let i = 0; i < text.length; i++) {
    const c = /** @type {string} */ (text[i]);
    if (c === "#" && /^[ \t\n]?$/.test(text[i - 1] ?? "")) {
      // PowerShell ends a line comment at a carriage return; any control character ends it here.
      const end = text.slice(i).search(/[\p{Cc}\p{Zl}\p{Zp}]/u);
      if (end < 0) return kept;
      i += end - 1;
    } else if (/[\w \t\n.,:;=+\-/!?|&>~*]/.test(c)) kept += c;
    // Quotes, escapes, expansions, brackets, `<#`, `--%` and non-ASCII may read differently.
    else return kept + text.slice(i);
  }
  return kept;
}

/** Require single-line value separators; quoted punctuation stays in one token. @param {string} text */
export function validateTomlValues(text) {
  /** @type {{table:boolean,array:boolean,names:string[]}[]} */ const statements =
    [];
  for (const line of text.split("\n")) {
    /** @type {string[]} */ const tokens =
      line.match(
        /"(?:\\.|[^"\\])*"|'[^']*'|#[^\n]*|[^\s#,"'=[\]{}]+|[=,[\]{}]/g,
      ) ?? [];
    const comment = tokens.findIndex((token) => token.startsWith("#"));
    if (comment >= 0) tokens.splice(comment);
    const assignment = tokens.indexOf("=");
    if (assignment < 0) {
      if (tokens.length === 0) continue;
      const width = tokens[0] === "[" && tokens[1] === "[" ? 2 : 1;
      if (
        (width === 2 &&
          (!line.trimStart().startsWith("[[") ||
            !/\]\]\s*(?:#.*)?$/.test(line))) ||
        !tokens.slice(0, width).every((token) => token === "[") ||
        !tokens.slice(-width).every((token) => token === "]") ||
        !validTomlKey(tokens.slice(width, -width))
      )
        throw new Error("INSTALL-CONFIG: invalid Codex TOML table header");
      statements.push({
        table: true,
        array: width === 2,
        names: tomlKeyNames(tokens.slice(width, -width)),
      });
      continue;
    }
    if (!validTomlKey(tokens.slice(0, assignment)))
      throw new Error("INSTALL-CONFIG: invalid Codex TOML assignment key");
    statements.push({
      table: false,
      array: false,
      names: tomlKeyNames(tokens.slice(0, assignment)),
    });
    let at = assignment + 1;
    /** @returns {void} */
    function value() {
      let token = tokens[at++];
      if (!token || /^[,=\]}]$/.test(token))
        throw new Error("INSTALL-CONFIG: missing Codex TOML value");
      if (token !== "[" && token !== "{") {
        // TOML permits one space between a date and its time.
        if (
          /^\d{4}-\d\d-\d\d$/.test(token) &&
          /^\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)?$/.test(
            tokens[at] ?? "",
          )
        )
          token += ` ${tokens[at++]}`;
        if (!validTomlScalar(token))
          throw new Error("INSTALL-CONFIG: invalid Codex TOML scalar");
        return;
      }
      const inline = token === "{";
      const close = inline ? "}" : "]";
      const members = new Set();
      const parents = new Set();
      if (tokens[at] === close) {
        at++;
        return;
      }
      while (at < tokens.length) {
        if (inline) {
          const start = at;
          while (at < tokens.length && tokens[at] !== "=") at++;
          if (!validTomlKey(tokens.slice(start, at)) || tokens[at++] !== "=")
            throw new Error(
              "INSTALL-CONFIG: invalid Codex TOML inline table key",
            );
          const names = tomlKeyNames(tokens.slice(start, at - 1));
          const member = JSON.stringify(names);
          for (let i = 1; i <= names.length; i++)
            if (members.has(JSON.stringify(names.slice(0, i))))
              throw new Error(
                "INSTALL-CONFIG: duplicate Codex TOML inline key",
              );
          if (parents.has(member))
            throw new Error(
              "INSTALL-CONFIG: conflicting Codex TOML inline key",
            );
          members.add(member);
          for (let i = 1; i < names.length; i++)
            parents.add(JSON.stringify(names.slice(0, i)));
        }
        value();
        if (tokens[at] === close) {
          at++;
          return;
        }
        if (tokens[at++] !== ",")
          throw new Error("INSTALL-CONFIG: missing Codex TOML value separator");
        if (tokens[at] === close && !inline) {
          at++;
          return;
        }
      }
      throw new Error(
        "INSTALL-CONFIG: unfinished Codex TOML array or inline table",
      );
    }
    value();
    if (at !== tokens.length)
      throw new Error("INSTALL-CONFIG: missing Codex TOML value separator");
  }
  return statements;
}

/** Normalize quoted and dotted spellings after key validation. @param {string[]} tokens */
function tomlKeyNames(tokens) {
  return (
    tokens.join(" ").match(/"(?:\\.|[^"\\])*"|'[^']*'|[\w-]+/g) ?? []
  ).map((name) => {
    if (name.startsWith("'")) return name.slice(1, -1);
    if (!name.startsWith('"')) return name;
    return JSON.parse(
      name.replace(
        /\\(?:U([\da-fA-F]{8})|[btnfr"\\]|u[\da-fA-F]{4})/g,
        (spelling, point) =>
          point === undefined
            ? spelling
            : JSON.stringify(
                String.fromCodePoint(Number.parseInt(point, 16)),
              ).slice(1, -1),
      ),
    );
  });
}

/** Bare, quoted and dotted keys share their grammar in every position. @param {string[]} tokens */
function validTomlKey(tokens) {
  return (
    /^(?:[\w-]+|"(?:\\.|[^"\\])*"|'[^']*')(?:\s*\.\s*(?:[\w-]+|"(?:\\.|[^"\\])*"|'[^']*'))*$/.test(
      tokens.join(" "),
    ) &&
    tokens.every(
      (token) =>
        (!token.startsWith('"') && !token.startsWith("'")) ||
        validTomlScalar(token),
    )
  );
}

/** Scalar grammar only; the editor separately refuses multiline strings. @param {string} token */
function validTomlScalar(token) {
  if (
    [...token].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9) || code === 127;
    })
  )
    return false;
  if (token.startsWith("'")) return true;
  if (token.startsWith('"')) {
    if (
      !/^"(?:[^"\\]|\\(?:[btnfr"\\]|u[\da-fA-F]{4}|U[\da-fA-F]{8}))*"$/.test(
        token,
      )
    )
      return false;
    return [
      ...token.matchAll(/\\(?:u([\da-fA-F]{4})|U([\da-fA-F]{8})|[btnfr"\\])/g),
    ].every((match) => {
      if (match[1] === undefined && match[2] === undefined) return true;
      const point = Number.parseInt(match[1] ?? match[2] ?? "", 16);
      return point <= 0x10ffff && (point < 0xd800 || point > 0xdfff);
    });
  }
  if (token === "true" || token === "false") return true;
  if (
    /^[+-]?(?:0|[1-9](?:_?\d)*)$|^0x[\da-fA-F](?:_?[\da-fA-F])*$|^0o[0-7](?:_?[0-7])*$|^0b[01](?:_?[01])*$/.test(
      token,
    )
  ) {
    const number = BigInt(token.replaceAll("_", ""));
    return number >= -(1n << 63n) && number < 1n << 63n;
  }
  if (
    /^[+-]?(?:(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*(?:[eE][+-]?\d(?:_?\d)*)?|[eE][+-]?\d(?:_?\d)*)|inf|nan)$/.test(
      token,
    )
  )
    return true;
  const match =
    /^(?:(\d{4}-\d\d-\d\d)(?:[Tt ](\d\d:\d\d:\d\d(?:\.\d+)?)([Zz]|[+-]\d\d:\d\d)?)?|(\d\d:\d\d:\d\d(?:\.\d+)?))$/.exec(
      token,
    );
  if (!match) return false;
  const [, date, clock, offset, onlyClock] = match;
  if (date) {
    const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days =
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ??
      0;
    if (day < 1 || day > days) return false;
  }
  const time = clock ?? onlyClock;
  if (time) {
    const [hours = 0, minutes = 0, seconds = 0] = time.split(":").map(Number);
    if (hours > 23 || minutes > 59 || seconds >= 60) return false;
  }
  if (offset && offset !== "Z" && offset !== "z") {
    const [hours = 0, minutes = 0] = offset.slice(1).split(":").map(Number);
    if (hours > 23 || minutes > 59) return false;
  }
  return true;
}

/** Valid TOML integers, retaining their original spelling. @param {string} line */
export function positiveTomlDepth(line) {
  const value =
    /^\s*(?:max_depth|"max_depth"|'max_depth')\s*=\s*([+-]?(?:0|[1-9](?:_?\d)*)|0x[\da-fA-F](?:_?[\da-fA-F])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)\s*(?:#.*)?$/.exec(
      line,
    )?.[1];
  return value !== undefined && BigInt(value.replaceAll("_", "")) > 0n;
}
