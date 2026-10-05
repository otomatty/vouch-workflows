import { inside, read } from "./install-files.mjs";
import { managedPath } from "./install-registration.mjs";
import {
  addHooks,
  block,
  json,
  pretty,
  removeBlock,
  removeHooks,
} from "./install-settings.mjs";
import { codexConfig } from "./install-toml.mjs";

export type Owned = {
  path: string;
  kind: "file" | "block" | "hooks";
  content: string;
  previous: string | null;
};
export type Installation = {
  v: 1;
  harness: string;
  scope: string;
  digest: string;
  runtimeRoot: string;
  owned: Owned[];
};

export function plan(root: string, prior: Installation | null) {
  const changes: Map<string, import("./install-files.mjs").Change> = new Map();
  const owned: Owned[] = [];
  const current = (path: string) =>
    changes.has(path)
      ? (changes.get(path) as import("./install-files.mjs").Change).after
      : read(inside(root, path));
  function put(path: string, after: string | null) {
    const previous = changes.get(path);
    changes.set(path, {
      path: inside(root, path),
      before: previous ? previous.before : read(inside(root, path)),
      after,
    });
  }
  for (const entry of prior?.owned ?? []) {
    const text = current(entry.path);
    let restored: string | null;
    if (entry.kind === "file") {
      if (text !== entry.content)
        throw new Error(`INSTALL-CONFLICT: ${entry.path}`);
      restored = entry.previous;
    } else if (entry.kind === "block")
      restored = removeBlock(text, entry.content, entry.previous);
    else restored = removeHooks(text, entry.content, entry.previous);
    put(entry.path, restored);
  }
  function claim(
    path: string,
    kind: Owned["kind"],
    content: string,
    after: string,
  ) {
    const previous = current(path);
    owned.push({ path, kind, content, previous });
    put(path, after);
  }
  return {
    changes,
    owned,
    current,
    put,
    file(path: string, text: string) {
      if (current(path) !== null)
        throw new Error(`INSTALL-CONFLICT: unmanaged ${path}`);
      claim(path, "file", text, text);
    },
    document(path: string, harness: string, body: string) {
      const before = current(path);
      const content = block(before, harness, body);
      claim(path, "block", content, `${before ?? ""}${content}`);
    },
    hooks(path: string, contribution: Record<string, unknown>) {
      claim(
        path,
        "hooks",
        pretty(contribution),
        addHooks(current(path), contribution),
      );
    },
    /** Design D8: create the file or append a marked block; never rewrite a table. */
    codex(path: string) {
      const before = current(path);
      const change = codexConfig(before);
      if (change.kind === "file")
        claim(path, "file", change.content, change.content);
      else if (change.kind === "block")
        claim(
          path,
          "block",
          change.content,
          `${before ?? ""}${change.content}`,
        );
    },
    merge(path: string, value: Record<string, unknown>) {
      put(path, pretty({ ...json(current(path)), ...value }));
    },
  };
}

export function readInstallation(text: string | null): Installation | null {
  if (text === null) return null;
  const value = json(text);
  if (
    value.v !== 1 ||
    !["claude", "codex", "cursor"].includes(String(value.harness)) ||
    !["project", "user"].includes(String(value.scope)) ||
    typeof value.runtimeRoot !== "string" ||
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest) ||
    !Array.isArray(value.owned)
  )
    throw new Error("INSTALL-STATE: invalid installation descriptor");
  for (const entry of value.owned)
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      !["file", "block", "hooks"].includes(entry.kind) ||
      typeof entry.content !== "string" ||
      (entry.previous !== null && typeof entry.previous !== "string")
    )
      throw new Error("INSTALL-STATE: invalid ownership record");
    // Design D4: a record never widens the managed set; a file claim never restores bytes.
    else if (
      !managedPath(String(value.harness), entry.kind, entry.path) ||
      (entry.kind === "file" && entry.previous !== null)
    )
      throw new Error(
        `INSTALL-STATE: ownership outside the managed files: ${String(entry.path)}`,
      );
  return value as Installation;
}
