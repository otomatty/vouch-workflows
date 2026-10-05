// Compile every TypeScript source to the .mjs file beside it; see docs/development/typescript.md.
// Runs directly through Node's type stripping, so it imports nothing from this repository.
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const roots = ["core", "harness", "scripts", "tests"];
const skipped =
  /(?:^|\/)(?:node_modules|tests\/fixtures|tests\/golden)(?:\/|$)/;
// The header carries a digest of the source and of this script, so a build skips a file
// only when neither changed, whatever the file times say.
const self = readFileSync(fileURLToPath(import.meta.url));
const header = (name: string, digest: string) =>
  `// Generated from ${name} by scripts/build.mts (${digest}); edit the .mts source.\n`;
const generated = /^\/\/ Generated from [^\s]+\.mts by scripts\/build\.mts[ ;]/;

function walk(directory: string): string[] {
  const path = relative(root, directory).replaceAll("\\", "/");
  if (skipped.test(path)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) return walk(child);
    return entry.isFile() ? [child] : [];
  });
}

const files = roots.flatMap((name) => walk(join(root, name)));
const sources = files.filter((file) => file.endsWith(".mts"));
let ts: typeof import("typescript") | undefined;
let written = 0;
for (const source of sources) {
  const target = source.replace(/\.mts$/, ".mjs");
  const code = readFileSync(source, "utf8");
  const digest = createHash("sha256").update(self).update(code).digest("hex");
  const head = header(basename(source), digest.slice(0, 16));
  if (existsSync(target) && readFileSync(target, "utf8").startsWith(head))
    continue;
  ts ??= (await import("typescript")).default;
  const result = ts.transpileModule(code, {
    fileName: source,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      verbatimModuleSyntax: true,
      newLine: ts.NewLineKind.LineFeed,
    },
  });
  const errors = result.diagnostics ?? [];
  if (errors.length > 0)
    throw new Error(
      `BUILD-SYNTAX: ${relative(root, source)}: ${ts.flattenDiagnosticMessageText(errors[0]?.messageText ?? "", "\n")}`,
    );
  writeFileSync(target, head + result.outputText);
  written++;
}
// A generated file whose source was removed must not keep running.
let removed = 0;
for (const file of files) {
  if (!file.endsWith(".mjs") || existsSync(file.replace(/\.mjs$/, ".mts")))
    continue;
  if (generated.test(readFileSync(file, "utf8"))) {
    unlinkSync(file);
    removed++;
  }
}
console.log(
  `Build: ${sources.length} sources, ${written} written, ${removed} removed.`,
);
