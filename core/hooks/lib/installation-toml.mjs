import { validateTomlValues } from "./words.mjs";

/** @typedef {{section:string,key:string,line:string,previous:string|null,createdTable?:boolean}} Setting */

/** Refuse names and values the line editor cannot safely recognize.
 * Ordinary quoted strings and comments may contain triple quotes. @param {string} text */
function rejectMultiline(text) {
  let quote = "";
  let value = false;
  let missingValue = false;
  /** @type {string[]} */ const containers = [];
  for (let i = 0; i < text.length; i++) {
    const character = text[i] ?? "";
    if (character === "\n") {
      if (missingValue)
        throw new Error("INSTALL-CONFIG: missing Codex TOML value");
      if (quote)
        throw new Error("INSTALL-CONFIG: unfinished Codex TOML string");
      if (containers.length > 0)
        throw new Error(
          "INSTALL-CONFIG: unsupported multiline Codex TOML array or inline table",
        );
      value = false;
    }
    if (quote) {
      if (quote === '"' && character === "\\") {
        if (!value)
          throw new Error(
            "INSTALL-CONFIG: unsupported escaped Codex TOML name",
          );
        if (text[i + 1] === "\n" || text[i + 1] === "\r")
          throw new Error("INSTALL-CONFIG: unfinished Codex TOML string");
        i++;
      } else if (character === quote) quote = "";
      continue;
    }
    if (character === "#") {
      if (missingValue)
        throw new Error("INSTALL-CONFIG: missing Codex TOML value");
      if (containers.length > 0)
        throw new Error(
          "INSTALL-CONFIG: unsupported multiline Codex TOML array or inline table",
        );
      const end = text.indexOf("\n", i);
      if (end < 0) break;
      i = end;
      value = false;
      continue;
    }
    if (
      missingValue &&
      (/[,=]/.test(character) ||
        (containers.length > 0 && /[\]}]/.test(character)))
    )
      throw new Error("INSTALL-CONFIG: missing Codex TOML value");
    if (missingValue && !/[ \t\r]/.test(character)) missingValue = false;
    if (character === "=") {
      value = true;
      missingValue = true;
    } else if (value && (character === "[" || character === "{"))
      containers.push(character);
    else if (value && (character === "]" || character === "}")) {
      if (containers.pop() !== (character === "]" ? "[" : "{"))
        throw new Error(
          "INSTALL-CONFIG: mismatched Codex TOML array or inline table",
        );
    }
    if (character !== '"' && character !== "'") continue;
    if (text.slice(i, i + 3) === character.repeat(3))
      throw new Error("INSTALL-CONFIG: unsupported multiline Codex TOML value");
    quote = character;
  }
  if (missingValue) throw new Error("INSTALL-CONFIG: missing Codex TOML value");
  if (quote) throw new Error("INSTALL-CONFIG: unfinished Codex TOML string");
  if (containers.length > 0)
    throw new Error(
      "INSTALL-CONFIG: unfinished Codex TOML array or inline table",
    );
  validateTomlValues(text);
}
/** @param {string} text @param {string} section */
function sectionBounds(text, section) {
  const lines = text.split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const managedKey = section === "features" ? "hooks" : "max_depth";
  const managedName = `(?:${managedKey}|"${managedKey}"|'${managedKey}')`;
  const nestedHeading = new RegExp(
    `^\\s*\\[\\[?\\s*(?:${section}|"${section}"|'${section}')\\s*\\.\\s*${managedName}\\s*(?:\\.|\\])`,
  );
  const heading = new RegExp(
    `^\\s*\\[\\s*(?:${section}|"${section}"|'${section}')\\s*\\]\\s*(?:#.*)?$`,
  );
  const starts = lines.flatMap((line, index) =>
    heading.test(line) ? [index] : [],
  );
  if (
    starts.length > 1 ||
    lines.some(
      (line, index) =>
        nestedHeading.test(line) ||
        ((firstTable < 0 || index < firstTable) &&
          new RegExp(
            `^\\s*(?:${section}|"${section}"|'${section}')\\s*[.=]`,
          ).test(line)) ||
        new RegExp(
          `^\\s*\\[\\[\\s*(?:${section}|"${section}"|'${section}')\\s*\\]\\]`,
        ).test(line),
    )
  )
    throw new Error(
      "INSTALL-CONFIG: ambiguous or unsupported Codex table layout",
    );
  const start = section ? (starts[0] ?? -1) : -1;
  if (section && start < 0) return { lines, start: -2, end: lines.length };
  let end = start + 1;
  for (; end < lines.length && !/^\s*\[/.test(lines[end] ?? ""); end++);
  if (
    lines
      .slice(start + 1, end)
      .some((line) => new RegExp(`^\\s*${managedName}\\s*\\.`).test(line))
  )
    throw new Error(
      "INSTALL-CONFIG: managed Codex setting has dotted children",
    );
  return { lines, start, end };
}

/** Valid TOML integers, retaining their original spelling. @param {string} line */
function positiveDepth(line) {
  const value =
    /^\s*(?:max_depth|"max_depth"|'max_depth')\s*=\s*([+-]?(?:0|[1-9](?:_?\d)*)|0x[\da-fA-F](?:_?[\da-fA-F])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)\s*(?:#.*)?$/.exec(
      line,
    )?.[1];
  return value !== undefined && BigInt(value.replaceAll("_", "")) > 0n;
}

/** @param {string|null} before */
export function enableCodex(before) {
  let text = before ?? "";
  rejectMultiline(text);
  /** @type {Setting[]} */ const settings = [];
  for (const [section, key, value] of [
    ["features", "hooks", "true"],
    ["agents", "max_depth", "1"],
  ]) {
    if (!section || !key || !value) continue;
    const { lines, start, end } = sectionBounds(text, section);
    const keyPattern = new RegExp(`^\\s*(?:${key}|"${key}"|'${key}')\\s*=`);
    const index =
      start === -2
        ? -1
        : lines.findIndex(
            (line, i) => i > start && i < end && keyPattern.test(line),
          );
    if (
      start >= 0 &&
      lines.filter((line, i) => i > start && i < end && keyPattern.test(line))
        .length > 1
    )
      throw new Error("INSTALL-CONFIG: duplicate Codex setting");
    const previous = index < 0 ? null : /** @type {string} */ (lines[index]);
    if (key === "max_depth" && previous && positiveDepth(previous)) continue;
    const line = `${key} = ${value}`;
    if (
      previous &&
      new RegExp(
        `^\\s*(?:${key}|"${key}"|'${key}')\\s*=\\s*${value}\\s*(?:#.*)?$`,
      ).test(previous)
    )
      continue;
    settings.push({
      section,
      key,
      line,
      previous,
      ...(start === -2 ? { createdTable: true } : {}),
    });
    if (start === -2)
      text = `${text.replace(/\n*$/, "")}\n\n[${section}]\n${line}\n`;
    else {
      if (index < 0) lines.splice(start + 1, 0, line);
      else lines[index] = line;
      text = lines.join("\n");
    }
  }
  return { text, content: `${JSON.stringify(settings, null, 2)}\n` };
}

/** @param {string|null} text @param {string} content @param {string|null} previous */
export function removeCodex(text, content, previous) {
  if (text === null)
    throw new Error("INSTALL-CONFLICT: owned Codex configuration missing");
  enableCodex(text);
  const original = text;
  /** @type {Setting[]} */ const settings = JSON.parse(content);
  for (const setting of settings.reverse()) {
    const { lines, start, end } = sectionBounds(text, setting.section);
    const index = lines.findIndex(
      (line, i) => i > start && i < end && line === setting.line,
    );
    if (start === -2 || index < 0)
      throw new Error("INSTALL-CONFLICT: owned Codex setting changed");
    if (setting.previous === null) lines.splice(index, 1);
    else lines[index] = setting.previous;
    if (setting.createdTable === true) {
      const remaining = sectionBounds(lines.join("\n"), setting.section);
      if (remaining.lines[remaining.start] !== `[${setting.section}]`)
        throw new Error("INSTALL-CONFLICT: owned Codex table header changed");
      if (
        remaining.lines
          .slice(remaining.start + 1, remaining.end)
          .every((line) => /^\s*(?:#.*)?$/.test(line))
      )
        lines.splice(remaining.start, 1);
    }
    text = lines.join("\n");
  }
  // Exact prior bytes when no unrelated setting was changed.
  if (enableCodex(previous).text === original) return previous;
  return text;
}
