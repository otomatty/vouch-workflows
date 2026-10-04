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
  for (const line of text.split("\n")) {
    /** @type {string[]} */ const tokens =
      line.match(
        /"(?:\\.|[^"\\])*"|'[^']*'|#[^\n]*|[^\s#,"'=[\]{}]+|[=,[\]{}]/g,
      ) ?? [];
    const comment = tokens.findIndex((token) => token.startsWith("#"));
    if (comment >= 0) tokens.splice(comment);
    const assignment = tokens.indexOf("=");
    if (assignment < 0) continue;
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
      if (tokens[at] === close) {
        at++;
        return;
      }
      while (at < tokens.length) {
        if (inline) {
          const start = at;
          while (at < tokens.length && tokens[at] !== "=") at++;
          const key = tokens.slice(start, at).join(" ");
          if (
            !/^(?:[\w-]+|"(?:\\.|[^"\\])*"|'[^']*')(?:\s*\.\s*(?:[\w-]+|"(?:\\.|[^"\\])*"|'[^']*'))*$/.test(
              key,
            ) ||
            tokens[at++] !== "="
          )
            throw new Error(
              "INSTALL-CONFIG: invalid Codex TOML inline table key",
            );
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
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      Number.isNaN(parsed.valueOf()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      return false;
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
