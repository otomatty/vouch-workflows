import { test } from "node:test";
import { parseShell, readsOnly } from "../../../core/hooks/lib/shell.mjs";

/** @param {string} text */
const words = (text) => parseShell(text).commands.map((item) => item.words);

test("parseShell splits simple commands and keeps quoted words, expansions and output targets", (t) => {
  const parsed = parseShell(
    `cat 'a b' "c$X" d\\ e | jq . > out 2>/dev/null; cd x && ls *.md ~/y`,
  );
  t.plan(2);
  t.assert.deepEqual(parsed.commands, [
    {
      words: ["cat", "a b", "c$X", "d e"],
      expands: [false, false, true, false],
      writes: false,
      depth: 0,
    },
    {
      words: ["jq", ".", "out", "/dev/null"],
      expands: [false, false, false, false],
      writes: true,
      depth: 0,
    },
    { words: ["cd", "x"], expands: [false, false], writes: false, depth: 0 },
    {
      words: ["ls", "*.md", "~/y"],
      expands: [false, true, true],
      writes: false,
      depth: 0,
    },
  ]);
  t.assert.equal(parsed.dynamic, false);
});

test("parseShell treats descriptor duplication, input and null devices as non-writing", (t) => {
  const cases = [
    "echo x 2>&1 >&2 1>&-",
    "cat < in <<< word",
    "cat a >/dev/null 2>>/dev/null",
    "ls | wc -l",
  ];
  t.plan(cases.length);
  for (const text of cases)
    t.assert.equal(
      parseShell(text).commands.some((item) => item.writes),
      false,
      text,
    );
});

test("parseShell marks every output redirection to a file as a write", (t) => {
  const cases = [
    "echo x > f",
    "echo x >> f",
    "echo x >| f",
    "ls &> log",
    "ls &>> log",
    "exec 3<> f",
    "echo x 2> err",
    "echo x >&f",
  ];
  t.plan(cases.length);
  for (const text of cases)
    t.assert.equal(
      parseShell(text).commands.some((item) => item.writes),
      true,
      text,
    );
});

test("parseShell reads here-documents as words of their command without parsing them as commands", (t) => {
  t.plan(2);
  t.assert.deepEqual(words("cat > f <<'EOF'\nline 'x\nEOF\necho done"), [
    ["cat", "f", "line", "'x"],
    ["echo", "done"],
  ]);
  t.assert.deepEqual(words("cat <<-END | wc\n\tone two\n\tEND\nls"), [
    ["cat", "one", "two"],
    ["wc"],
    ["ls"],
  ]);
});

test("parseShell tracks subshell depth and marks substitutions as dynamic", (t) => {
  const grouped = parseShell("(cd vouch && rm -rf x); echo ok");
  const substituted = parseShell("echo $(pwd) `date` <(ls)");
  t.plan(4);
  t.assert.deepEqual(
    grouped.commands.map((item) => [item.words, item.depth]),
    [
      [["cd", "vouch"], 1],
      [["rm", "-rf", "x"], 1],
      [["echo", "ok"], 0],
    ],
  );
  t.assert.equal(grouped.dynamic, false);
  t.assert.deepEqual(
    substituted.commands.map((item) => [item.words, item.depth]),
    [
      [["echo"], 0],
      [["pwd"], 1],
      [["date"], 1],
      [["ls"], 1],
    ],
  );
  t.assert.equal(substituted.dynamic, true);
});

test("parseShell keeps escaped characters inside double quotes literal", (t) => {
  const parsed = parseShell('echo "a\\"b" "\\$HOME" "x\\\ny" "end\\');
  t.plan(2);
  t.assert.deepEqual(parsed.commands[0]?.words, [
    "echo",
    'a"b',
    "$HOME",
    "xy",
    "end\\",
  ]);
  t.assert.deepEqual(parsed.commands[0]?.expands, [
    false,
    false,
    false,
    false,
    false,
  ]);
});

test("parseShell drops duplicated input descriptors but keeps input files as words", (t) => {
  t.plan(1);
  t.assert.deepEqual(parseShell("cat <&3 < in").commands, [
    { words: ["cat", "in"], expands: [false, false], writes: false, depth: 0 },
  ]);
});

test("parseShell skips comments, joins continued lines and keeps unterminated quotes", (t) => {
  t.plan(4);
  t.assert.deepEqual(words("ls # rm -rf vouch\necho a#b"), [
    ["ls"],
    ["echo", "a#b"],
  ]);
  t.assert.deepEqual(words("cat \\\n file"), [["cat", "file"]]);
  t.assert.deepEqual(words("echo 'abc"), [["echo", "abc"]]);
  t.assert.deepEqual(words('a=1 b="2 3" cmd\n\n'), [["a=1", "b=2 3", "cmd"]]);
});

/** @param {string} text @param {(word:string)=>boolean} [doctor] */
function reading(text, doctor = () => false) {
  const parsed = parseShell(text);
  return (
    !parsed.dynamic &&
    parsed.commands.every((command) => readsOnly(command, doctor))
  );
}

test("readsOnly accepts recognized reading commands and non-writing git subcommands", (t) => {
  const cases = [
    "cat a",
    "head -n 5 a | tail -n 2",
    "grep -r x .",
    "sed -n '1,20p' a",
    "sed -n -e '1,5p;10,$p' a",
    "nl -ba a | sed -n 1,40p",
    "git log --oneline -- a",
    "git -C x --no-pager diff a",
    "git add a",
    "git commit -m message",
    "find . -name x -type f",
    "sort -r a",
    "jq . a",
    "ls",
    "cd x && pwd",
    "if test -f a; then cat a; else echo none; fi",
    "{ cat a; }",
    "wc -l a 2>/dev/null",
  ];
  t.plan(cases.length);
  for (const text of cases) t.assert.equal(reading(text), true, text);
});

test("readsOnly refuses writers, unknown programs, write options and smuggled options", (t) => {
  const cases = [
    "sed -i s/a/b/ a",
    "sed 's/a/b/' a",
    "sed -n '1w out' a",
    'sed -n "$S" a',
    "sed -n 1p *",
    "sort -o out a",
    "sort -uo out a",
    "sort --output=out a",
    "find . -delete",
    "find . -exec rm {} ;",
    "git checkout a",
    "git -c core.pager=x log",
    "git diff --output=x",
    "git grep -O x",
    "git",
    "git -C",
    "rg --pre x y",
    "file -C",
    "cat a | tee b",
    "cat a > b",
    "python3 x",
    "/bin/cat a",
    "LC_ALL=C cat a",
    "rm a",
    "awk 1 a",
    "for x in a; do cat $x; done",
    "echo $(cat a)",
    "node x.mjs",
  ];
  t.plan(cases.length);
  for (const text of cases) t.assert.equal(reading(text), false, text);
});

test("readsOnly accepts node only for the installed doctor as its single argument", (t) => {
  const doctor = (/** @type {string} */ word) =>
    word === "install/hooks/vouch-doctor.mjs";
  t.plan(3);
  t.assert.equal(reading("node install/hooks/vouch-doctor.mjs", doctor), true);
  t.assert.equal(
    reading("node install/hooks/vouch-doctor.mjs extra", doctor),
    false,
  );
  t.assert.equal(reading("node --eval x", doctor), false);
});
