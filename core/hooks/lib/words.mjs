// Shell word expansion and comments for the guard's word passes; see docs/development/write-guard.md.

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
