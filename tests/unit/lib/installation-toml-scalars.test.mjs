import { test } from "node:test";
import {
  enableCodex,
  removeCodex,
} from "../../../core/hooks/lib/installation-toml.mjs";

const enabled = "[features]\nhooks = true\n[agents]\nmax_depth = 3\n";
test("Codex refuses invalid TOML scalars in every value position before editing", (t) => {
  for (const value of [
    "hello",
    "TRUE",
    "01",
    "-01",
    "1__0",
    "1_",
    ".1",
    "1.",
    "01.2",
    "1e",
    "1e_2",
    "0xG",
    "+0x1",
    "0o8",
    "0b2",
    "9223372036854775808",
    "-9223372036854775809",
    "0xffffffffffffffff",
    '"bad\\q"',
    '"bad\\u123"',
    '"bad\\uD800"',
    '"bad\\U00110000"',
    '"bad\x01"',
    "'bad\x7f'",
    "2026-02-30",
    "1900-02-29",
    "2026-13-01",
    "2026-01-00",
    "24:00:00",
    "23:60:00",
    "23:59:60",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00+01:60",
  ])
    for (const spelling of [value, `[${value}]`, `{ a = ${value} }`])
      for (const prefix of ["", enabled]) {
        const text = `${prefix}bad = ${spelling}\n`;
        t.assert.throws(() => enableCodex(text), /INSTALL-CONFIG/);
        t.assert.throws(() => removeCodex(text, "[]", null), /INSTALL-CONFIG/);
      }
});
test("Codex preserves every supported scalar spelling and nested value without changing bytes", (t) => {
  for (const value of [
    "true",
    "false",
    "0",
    "+0",
    "-0",
    "+1_000",
    "-1_000",
    "0xF_F",
    "0o7_7",
    "0b1_01",
    "9223372036854775807",
    "-9223372036854775808",
    "1.2",
    "+1.2_3",
    "-0.2",
    "1e+2",
    "1.2e-3",
    "1_0.2_0E1_0",
    "0e0",
    "inf",
    "+inf",
    "-inf",
    "nan",
    "+nan",
    "-nan",
    '""',
    "''",
    '"a\\n\\t\\b\\f\\r\\"\\\\"',
    '"\\u0061 \\U0001F600"',
    '"\\\\uD800"',
    '"\\\\U00110000"',
    '"😀\t"',
    "'a\\b\t'",
    "1979-05-27",
    "2000-02-29",
    "2024-02-29",
    "07:32:00",
    "23:59:59.999",
    "1979-05-27T07:32:00Z",
    "1979-05-27t07:32:00z",
    "1979-05-27 07:32:00Z",
    "1979-05-27T07:32:00",
    "1979-05-27T07:32:00.999-07:00",
    "0000-01-01",
  ])
    for (const spelling of [value, `[${value}]`, `{ a = ${value} }`]) {
      const text = `${enabled}kept = ${spelling} # original bytes\n`;
      t.assert.equal(enableCodex(text).text, text, spelling);
      t.assert.equal(removeCodex(text, "[]", null), text, spelling);
    }
});
