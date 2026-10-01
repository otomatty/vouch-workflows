import { test } from "node:test";
import {
  parseShell,
  programOf,
  readsOnly,
} from "../../../core/hooks/lib/shell.mjs";

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

test("readsOnly accepts node only for an installed command with literal word arguments", (t) => {
  const doctor = (/** @type {string} */ word) =>
    word === "install/hooks/vouch-question.mjs";
  t.plan(12);
  t.assert.equal(
    reading("node install/hooks/vouch-question.mjs", doctor),
    true,
  );
  t.assert.equal(
    reading("node install/hooks/vouch-question.mjs ask Q-1", doctor),
    true,
  );
  for (const text of [
    "node install/hooks/vouch-question.mjs ask $Q",
    'node install/hooks/vouch-question.mjs ask "$Q"',
    `node install/hooks/vouch-question.mjs ask $${"{Q}"}`,
    "node install/hooks/vouch-question.mjs ask Q-{1,2}",
    "node install/hooks/vouch-question.mjs ask ~",
    "node install/hooks/vouch-question.mjs ask Q-1*",
    "node install/hooks/vouch-question.mjs ask ../x",
    "node install/hooks/vouch-question.mjs --eval x",
    "node install/hooks/vouch-question.mjs ask Q-1 > out",
    "node --eval x",
  ])
    t.assert.equal(reading(text, doctor), false, text);
});

test("parseShell reads process substitution inside a word as bash does", (t) => {
  const parsed = parseShell("echo a>(cat) b<(ls)");
  t.plan(2);
  t.assert.equal(parsed.dynamic, true);
  t.assert.deepEqual(
    parsed.commands.map((item) => [item.words, item.writes, item.depth]),
    [
      [["echo", "a"], false, 0],
      [["cat"], false, 1],
      [["b"], false, 0],
      [["ls"], false, 1],
    ],
  );
});

test("parseShell splits at tabs and carriage returns and keeps escaped and trailing characters", (t) => {
  const escaped = parseShell("echo \\$HOME a\\");
  t.plan(4);
  t.assert.deepEqual(words("a\tb\rc"), [["a", "b", "c"]]);
  t.assert.deepEqual(escaped.commands[0]?.words, ["echo", "$HOME", "a"]);
  t.assert.deepEqual(escaped.commands[0]?.expands, [false, false, false]);
  t.assert.deepEqual(words("a;;b;"), [["a"], ["b"]]);
});

test("parseShell keeps descriptor numbers out of words and reads other redirection targets", (t) => {
  t.plan(4);
  t.assert.deepEqual(parseShell("echo x 2>err a1>f 12>g x>h").commands, [
    {
      words: ["echo", "x", "err", "a1", "f", "g", "x", "h"],
      expands: Array(8).fill(false),
      writes: true,
      depth: 0,
    },
  ]);
  t.assert.deepEqual(parseShell("echo x >&x1 >&12 >&-").commands, [
    {
      words: ["echo", "x", "x1"],
      expands: [false, false, false],
      writes: true,
      depth: 0,
    },
  ]);
  t.assert.deepEqual(parseShell("echo x > 1").commands[0]?.words, [
    "echo",
    "x",
    "1",
  ]);
  t.assert.deepEqual(parseShell("ls &> log").commands, [
    { words: ["ls", "log"], expands: [false, false], writes: true, depth: 0 },
  ]);
});

test("parseShell strips here-document tabs only for <<- and CR line ends always", (t) => {
  t.plan(5);
  t.assert.deepEqual(words("cat <<EOF\r\nbody\r\nEOF\r\nls"), [
    ["cat", "body"],
    ["ls"],
  ]);
  t.assert.deepEqual(words("cat <<EOF\n\tEOF\nEOF"), [["cat", "EOF"]]);
  t.assert.deepEqual(words("cat <<-EOF\n\t\tx\n\t\tEOF\nls"), [
    ["cat", "x"],
    ["ls"],
  ]);
  t.assert.deepEqual(parseShell("cat <<EOF\n$x\nEOF").commands[0]?.expands, [
    false,
    false,
  ]);
  t.assert.deepEqual(parseShell("<<EOF\nvouch\nEOF").commands, [
    { words: ["vouch"], expands: [false], writes: false, depth: 0 },
  ]);
});

test("parseShell marks substitutions inside double quotes and backticks as dynamic", (t) => {
  t.plan(6);
  t.assert.equal(parseShell('echo "$(date)"').dynamic, true);
  t.assert.equal(parseShell('echo "a`b`"').dynamic, true);
  t.assert.equal(parseShell("echo `date`").dynamic, true);
  const plain = parseShell('echo "$x" a~b');
  t.assert.equal(plain.dynamic, false);
  t.assert.deepEqual(plain.commands[0]?.expands, [false, true, false]);
  t.assert.deepEqual(
    parseShell("a ) b # tail").commands.map((item) => [item.words, item.depth]),
    [
      [["a"], 0],
      [["b"], 0],
    ],
  );
});

test("readsOnly accepts sed quiet and extended forms and bundled short options it does not refuse", (t) => {
  const cases = [
    "sed -n 5p a",
    "sed --quiet 1p a",
    "sed --silent -E 1p a",
    "sed -r -n 1p a",
    "git -P log",
    "sort a-o",
    "cat $F",
  ];
  t.plan(cases.length);
  for (const text of cases) t.assert.equal(reading(text), true, text);
});

test("readsOnly refuses sed without -n, extra scripts, other options and expansions for strict programs", (t) => {
  const cases = [
    "sed 1p a",
    "sed -n -i 1p a",
    "sed -n -e 'w x' -e 1p a",
    "sed -n x1p a",
    "sed -n 1pz a",
    "git --paginate log",
    "sort $X",
    "find $D",
    "git log $R",
    "rg $P f",
    "file $F",
    "sort {-o,out} a",
    "git log {--output=x,}",
  ];
  t.plan(cases.length);
  for (const text of cases) t.assert.equal(reading(text), false, text);
});

test("programOf skips leading reserved words and identifier assignments only", (t) => {
  /** @param {string[]} words */
  const of = (...words) =>
    programOf({
      words,
      expands: words.map(() => false),
      writes: false,
      depth: 0,
    });
  t.plan(5);
  t.assert.deepEqual(of("if", "A=1", "rm", "-f"), ["rm", "-f"]);
  t.assert.deepEqual(of("a=b"), []);
  t.assert.deepEqual(of("-x=1", "ls"), ["-x=1", "ls"]);
  t.assert.deepEqual(of("1a=b", "ls"), ["1a=b", "ls"]);
  t.assert.deepEqual(of("A-B=1", "ls"), ["A-B=1", "ls"]);
});

test("parseShell marks unquoted braces as expanding and readers still read through them", (t) => {
  t.plan(3);
  t.assert.deepEqual(parseShell("cat {a,b} c").commands[0]?.expands, [
    false,
    true,
    false,
  ]);
  t.assert.equal(reading("cat f{1..3}.txt"), true);
  t.assert.equal(reading("{ cat a; }"), true);
});
