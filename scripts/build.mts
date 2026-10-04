// Compile every TypeScript source to the .mjs file beside it; see docs/development/typescript.md.
// Runs directly through Node's type stripping, so it imports nothing from this repository.
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const roots = ["core", "harness", "scripts", "tests"];
const skipped =
  /(?:^|\/)(?:node_modules|tests\/fixtures|tests\/golden)(?:\/|$)/;
const header = (name: string) =>
  `// Generated from ${name} by scripts/build.mts; edit the .mts source.\n`;
const generated = /^\/\/ Generated from [^\s]+\.mts by scripts\/build\.mts;/;

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
  if (
    existsSync(target) &&
    statSync(target).mtimeMs >= statSync(source).mtimeMs
  )
    continue;
  ts ??= (await import("typescript")).default;
  const result = ts.transpileModule(readFileSync(source, "utf8"), {
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
  const text = header(basename(source)) + result.outputText;
  if (!existsSync(target) || readFileSync(target, "utf8") !== text) {
    writeFileSync(target, text);
    written++;
  }
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
