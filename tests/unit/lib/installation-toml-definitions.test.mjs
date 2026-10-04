import { test } from "node:test";
import {
  enableCodex,
  removeCodex,
} from "../../../core/hooks/lib/installation-toml.mjs";

const enabled = "[features]\nhooks = true\n[agents]\nmax_depth = 3\n";
test("Codex rejects duplicate fully qualified keys and table/value conflicts before editing", (t) => {
  for (const invalid of [
    'model = "a"\nmodel = "b"',
    'model = "a"\n"model" = "b"',
    "[provider]\nmodel = 1\n'model' = 2",
    "[provider]\nmodel = 1\n[provider]\nother = 2",
    "x = 1\n[x]\na = 2",
    "[x]\na = 1\n[[x]]\na = 2",
    "[[x]]\na = 1\n[x]\na = 2",
    "[x.a]\nb = 1\n[[x]]\nc = 2",
    "[[x.a]]\nb = 1\n[[x]]\nc = 2",
    "x.a = 1\nx = 2",
    "x = 1\nx.a = 2",
    "x.a = 1\n[x]\nb = 2",
    "[x.a]\nb = 1\n[x]\na = 2",
    "x = { a = 1, a = 2 }",
    'x = { a = 1, "a" = 2 }',
    'x = { a = 1, "\\u0061" = 2 }',
    'x = { a = 1, "\\U00000061" = 2 }',
    "x = { a.b = 1, a = 2 }",
    "x = { a = 1, a.b = 2 }",
  ]) {
    const text = `${invalid}\n${enabled}`;
    t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/, text);
    t.assert.throws(
      () => removeCodex(text, "[]", null),
      /INSTALL-CONFIG/,
      text,
    );
  }
});
test("Codex preserves independent tables and repeated array-table elements with nested tables", (t) => {
  for (const valid of [
    "[one]\nmodel = 1\n[two]\nmodel = 2",
    "[[provider]]\nmodel = 1\n[[provider]]\nmodel = 2",
    "[[provider]]\n[provider.options]\nmodel = 1\n[[provider]]\n[provider.options]\nmodel = 2",
    "[[provider]]\n[[provider.tools]]\nmodel = 1\n[[provider.tools]]\nmodel = 2\n[[provider]]\n[[provider.tools]]\nmodel = 3",
    "[x.a]\nb = 1\n[x]\nc = 2",
    "[[x.a]]\nb = 1\n[x]\nc = 2",
    "x.a = 1\nx.b = 2",
    "x = { a.b = 1, a.c = 2 }",
    'x = { "\\u0061" = 1, "\\\\u0061" = 2 }',
  ]) {
    const text = `${enabled}${valid}\n`;
    t.assert.equal(enableCodex(text).text, text);
    t.assert.equal(removeCodex(text, "[]", null), text);
  }
});
