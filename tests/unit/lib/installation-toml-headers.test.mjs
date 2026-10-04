import { test } from "node:test";
import {
  enableCodex,
  removeCodex,
} from "../../../core/hooks/lib/installation-toml.mjs";

const enabled = "[features]\nhooks = true\n[agents]\nmax_depth = 3\n";
test("Codex refuses malformed table headers and incomplete statements before editing", (t) => {
  for (const invalid of [
    "[provider",
    "[provider]]",
    "[[provider]",
    "[[provider]]]",
    "[ [provider]]",
    "[[provider] ]",
    "[]",
    "[[]]",
    "[provider..model]",
    "[provider model]",
    "[provider] trailing",
    '["unfinished]',
    '["bad\x01"]',
    "bad",
    "bad # trailing",
    "bad key = 1",
    "= 1",
    "a..b = 1",
  ])
    for (const prefix of ["", enabled]) {
      const text = `${prefix}${invalid} # trailing`;
      t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
      t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
    }
});
test("Codex preserves valid quoted and dotted tables, array tables and assignments", (t) => {
  for (const header of [
    "[provider]",
    ' [ "provider" . model ]',
    "[ 'provider' . 'model.name' ]",
    "[[provider]]",
    '[[ "provider" . model ]]',
    '["# bracket ]"]',
  ]) {
    const text = `${enabled}${header} # exact header\n"kept key".nested = 1\n`;
    t.assert.equal(enableCodex(text).text, text);
    t.assert.equal(removeCodex(text, "[]", null), text);
  }
});
