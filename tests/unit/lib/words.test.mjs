import { test } from "node:test";
import { expandBraces, uncommented } from "../../../core/hooks/lib/words.mjs";

test("expandBraces expands like bash and keeps words without a valid brace expression", (t) => {
  /** @type {[string,string[]][]} */
  const cases = [
    ["plain", ["plain"]],
    ["a{b,c}d", ["abd", "acd"]],
    ["{a,b}{,c}", ["a", "ac", "b", "bc"]],
    ["{a,{b,c}}", ["a", "b", "c"]],
    ["{a{b,c}", ["{ab", "{ac"]],
    ["a{b,c}}", ["ab}", "ac}"]],
    ["x{a,b", ["x{a,b"]],
    ["{,}", ["", ""]],
    ["{a}", ["{a}"]],
    ["{}", ["{}"]],
    ["{a..c,d}", ["a..c", "d"]],
    ["{a..e..2}", ["a", "c", "e"]],
    ["{a..e..-2}", ["a", "c", "e"]],
    ["{a..c..0}", ["a", "b", "c"]],
    ["{e..a}", ["e", "d", "c", "b", "a"]],
    ["{e..a..2}", ["e", "c", "a"]],
    ["{Z..b}", ["Z", "[", "\\", "]", "^", "_", "`", "a", "b"]],
    ["{-../}", ["{-../}"]],
    ["{a..1}", ["{a..1}"]],
    ["au{d,}it", ["audit", "auit"]],
    // Digits never spell a protected name, so an integer sequence keeps its first value.
    ["x{1..300}y", ["x1y"]],
    ["v{-3..3..2}", ["v-3"]],
    ["{01..10}", ["01"]],
  ];
  t.plan(cases.length);
  for (const [word, expected] of cases)
    t.assert.deepEqual(expandBraces(word), expected, word);
});

test("expandBraces stops at 256 results", (t) => {
  t.plan(4);
  t.assert.equal(expandBraces("{a,b}".repeat(8))?.length, 256);
  t.assert.equal(expandBraces("{a,b}".repeat(9)), null);
  t.assert.equal(expandBraces("{a..z}{a..z}"), null);
  t.assert.equal(expandBraces("{a,b}{c,d,e}{1..99999}")?.length, 6);
});

test("uncommented drops comments only where POSIX shells and PowerShell read them alike", (t) => {
  /** @type {[string,string][]} */
  const cases = [
    ["echo ok > notes.txt # a/b", "echo ok > notes.txt "],
    ["# note\necho ok", "\necho ok"],
    ["#", ""],
    ["a # x\nb # y", "a \nb "],
    ["a && b || c; d | e & f # x", "a && b || c; d | e & f "],
    ["cp -r a_b/c.d:e=f+g!h?i~j*k l # x", "cp -r a_b/c.d:e=f+g!h?i~j*k l "],
    ["a\t# x", "a\t"],
    // A tab ends the stripped part early; the rest is kept.
    ["a # x\ty", "a \ty"],
    // PowerShell ends a comment at a carriage return; stripping stops there.
    ["echo ok # x\rrm y", "echo ok \rrm y"],
    ["echo a#b # c", "echo a#b # c"],
    ['echo "a" # x', 'echo "a" # x'],
    ["echo 'a' # x", "echo 'a' # x"],
    ["echo \\ # x", "echo \\ # x"],
    ['echo \\" #"; rm x', 'echo \\" #"; rm x'],
    ["Add-Content <#x#> y", "Add-Content <#x#> y"],
    ["(( x #)); rm y", "(( x #)); rm y"],
    ["a ) # x", "a ) # x"],
    ["cmd /c --% echo # & del y", "cmd /c --% echo # & del y"],
    ["echo $HOME # x", "echo $HOME # x"],
    ["echo `a` # x", "echo `a` # x"],
    ["echo {a,b} # x", "echo {a,b} # x"],
    ["echo @a # x", "echo @a # x"],
    ["echo [a] # x", "echo [a] # x"],
    ["echo \u201c #\u201d ; rm y", "echo \u201c #\u201d ; rm y"],
    ["echo \u00a0# x", "echo \u00a0# x"],
    ['# a "b" c\necho "d"', '\necho "d"'],
  ];
  t.plan(cases.length);
  for (const [text, expected] of cases)
    t.assert.equal(uncommented(text), expected, text);
});
