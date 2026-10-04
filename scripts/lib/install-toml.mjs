import { pretty } from "./install-settings.mjs";

/** @typedef {{section:string,key:string,line:string,previous:string|null}} Setting */
/** @param {string} text @param {string} section */
function sectionBounds(text, section) {
  const lines = text.split("\n");
  const heading = new RegExp(
    `^\\s*\\[\\s*(?:${section}|"${section}"|'${section}')\\s*\\]\\s*(?:#.*)?$`,
  );
  const starts = lines.flatMap((line, index) =>
    heading.test(line) ? [index] : [],
  );
  if (
    starts.length > 1 ||
    lines.some((line) =>
      new RegExp(`^\\s*(?:${section}|"${section}"|'${section}')\\s*[.=]`).test(
        line,
      ),
    )
  )
    throw new Error(
      "INSTALL-CONFIG: ambiguous or unsupported Codex table layout",
    );
  const start = section ? (starts[0] ?? -1) : -1;
  if (section && start < 0) return { lines, start: -2, end: lines.length };
  let end = start + 1;
  for (; end < lines.length && !/^\s*\[/.test(lines[end] ?? ""); end++);
  return { lines, start, end };
}

/** @param {string|null} before */
export function enableCodex(before) {
  let text = before ?? "";
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
    if (
      key === "max_depth" &&
      previous &&
      /^\s*(?:max_depth|"max_depth"|'max_depth')\s*=\s*[1-9]\d*\s*(?:#.*)?$/.test(
        previous,
      )
    )
      continue;
    const line = `${key} = ${value}`;
    if (
      previous &&
      new RegExp(
        `^\\s*(?:${key}|"${key}"|'${key}')\\s*=\\s*${value}\\s*(?:#.*)?$`,
      ).test(previous)
    )
      continue;
    settings.push({ section, key, line, previous });
    if (start === -2)
      text = `${text.replace(/\n*$/, "")}\n\n[${section}]\n${line}\n`;
    else {
      if (index < 0) lines.splice(start + 1, 0, line);
      else lines[index] = line;
      text = lines.join("\n");
    }
  }
  return { text, content: pretty(settings) };
}

/** @param {string|null} text @param {string} content @param {string|null} previous */
export function removeCodex(text, content, previous) {
  if (text === null)
    throw new Error("INSTALL-CONFLICT: owned Codex configuration missing");
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
    text = lines.join("\n");
  }
  // Exact prior bytes when no unrelated setting was changed.
  if (enableCodex(previous).text === original) return previous;
  return text;
}
