// Adversarial tests for SPEC.md sentences the practice set does not cover.
// Run: node advtest.mjs   (from the repo root; uses runner.ts runCheck)
import { runCheck } from './runner.ts';

const cases = [];
function add(name, o) {
  cases.push({ name, argv: o.argv ?? [], stdin: o.stdin ?? null, files: o.files ?? {}, expect: { exit: o.exit, stdout: o.stdout, changes: o.changes ?? {} } });
}

// ---------------------------------------------------------- CLI / usage
add('usage unknown option', { argv: ['--foo'], stdin: 'x', exit: 2, stdout: 'error: usage\n' });
add('usage duplicate check', { argv: ['--check', '--check'], stdin: 'x', exit: 2, stdout: 'error: usage\n' });
add('usage duplicate format', { argv: ['--format=json', '--format=unified'], stdin: 'x', exit: 2, stdout: 'error: usage\n' });
add('usage bad format value', { argv: ['--format=xml'], stdin: 'x', exit: 2, stdout: 'error: usage\n' });
add('usage two positionals', { argv: ['a.patch', 'b.patch'], stdin: 'x', exit: 2, stdout: 'error: usage\n' });
add('usage bare --format', { argv: ['--format', 'json'], stdin: 'x', exit: 2, stdout: 'error: usage\n' });
add('usage duplicate strict', { argv: ['--strict', '--strict'], stdin: 'x', exit: 2, stdout: 'error: usage\n' });
add('usage wins over no-patch', { argv: ['--bad', 'missing.patch'], exit: 2, stdout: 'error: usage\n' });
add('option after positional works', {
  argv: ['fix.patch', '--check'],
  files: { 'fix.patch': 'a.txt\n<<<<<<< SEARCH\nhello\n=======\nhi\n>>>>>>> REPLACE\n', 'a.txt': 'hello\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
});
add('dash dash then option-like file', { argv: ['--', '--check'], exit: 2, stdout: 'error: no-patch\n' });
add('dash reads stdin', {
  argv: ['-'],
  stdin: 'a.txt\n<<<<<<< SEARCH\nhello\n=======\nhi\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'hello\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'hi\n' },
});
add('format forced json on unified text', {
  argv: ['--format=json'],
  stdin: 'diff --git a/x b/y\n',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('format forced unified on json text', {
  argv: ['--format=unified'],
  stdin: '[{"command":"create","path":"a.txt","file_text":"hi"}]',
  exit: 2,
  stdout: 'error: parse 1\n',
});

// ---------------------------------------------------------- exit 2 ordering
add('no-patch', { argv: ['missing.patch'], exit: 2, stdout: 'error: no-patch\n' });
add('no-patch wins over format', { argv: ['missing.patch'], exit: 2, stdout: 'error: no-patch\n' });
add('empty stdin auto -> format', { argv: [], stdin: '', exit: 2, stdout: 'error: format\n' });
add('empty stdin forced json -> parse 1', { argv: ['--format=json'], stdin: '', exit: 2, stdout: 'error: parse 1\n' });
add('plain prose -> format', { argv: [], stdin: 'hello world\nthis is prose\n', exit: 2, stdout: 'error: format\n' });
add('parse before file lookup', {
  stdin: '--- a/nope.txt\n+++ b/nope.txt\n@@ bad header @@\n',
  exit: 2,
  stdout: 'error: parse 3\n',
});
add('missing file unified', {
  stdin: '--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-old\n+new\n',
  exit: 1,
  stdout: 'error: missing nope.txt\nfailed: 1 of 1 edits\n',
});

// ---------------------------------------------------------- output rows
add('ok 0 files noop replace', {
  stdin: 'a.txt\n<<<<<<< SEARCH\nhello\n=======\nhello\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'hello\n' },
  exit: 0,
  stdout: 'ok: 0 files\n',
});
add('ok 1 file singular', {
  stdin: 'a.txt\n<<<<<<< SEARCH\nhello\n=======\nhi\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'hello\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'hi\n' },
});
add('rows sorted byte order', {
  stdin:
    'b.txt\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n' +
    'a.txt\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n' +
    'A.txt\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'x\n', 'b.txt': 'x\n', 'A.txt': 'x\n' },
  exit: 0,
  stdout: 'M A.txt\nM a.txt\nM b.txt\nok: 3 files\n',
  changes: { 'a.txt': 'y\n', 'b.txt': 'y\n', 'A.txt': 'y\n' },
});
add('create then delete same patch -> ok 0', {
  stdin: '*** Begin Patch\n*** Add File: tmp.txt\n+hi\n*** Delete File: tmp.txt\n*** End Patch\n',
  exit: 0,
  stdout: 'ok: 0 files\n',
});
add('create lists A', {
  stdin: '[{"command":"create","path":"tmp.txt","file_text":"x"}]',
  exit: 0,
  stdout: 'A tmp.txt\nok: 1 file\n',
  changes: { 'tmp.txt': 'x' },
});

// ---------------------------------------------------------- paths / safety
add('unsafe dotdot', {
  stdin: '../x.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
  files: { 'x.txt': 'a\n' },
  exit: 1,
  stdout: 'error: unsafe ../x.txt\nfailed: 1 of 1 edits\n',
});
add('unsafe absolute', {
  stdin: '[{"command":"create","path":"/tmp/x.txt","file_text":"a"}]',
  exit: 1,
  stdout: 'error: unsafe /tmp/x.txt\nfailed: 1 of 1 edits\n',
});
add('unsafe backslash', {
  stdin: '[{"command":"create","path":"a\\\\b.txt","file_text":"a"}]',
  exit: 1,
  stdout: 'error: unsafe a\\b.txt\nfailed: 1 of 1 edits\n',
});
add('unsafe empty segment', {
  stdin: '[{"command":"create","path":"a//b.txt","file_text":"a"}]',
  exit: 1,
  stdout: 'error: unsafe a//b.txt\nfailed: 1 of 1 edits\n',
});
add('unsafe dot segment', {
  stdin: '[{"command":"create","path":"a/./b.txt","file_text":"a"}]',
  exit: 1,
  stdout: 'error: unsafe a/./b.txt\nfailed: 1 of 1 edits\n',
});
add('unsafe dotdot segment', {
  stdin: '[{"command":"create","path":"a/../b.txt","file_text":"a"}]',
  exit: 1,
  stdout: 'error: unsafe a/../b.txt\nfailed: 1 of 1 edits\n',
});
add('unsafe trailing slash', {
  stdin: '[{"command":"create","path":"a/","file_text":"a"}]',
  exit: 1,
  stdout: 'error: unsafe a/\nfailed: 1 of 1 edits\n',
});
add('unsafe empty path', {
  stdin: '[{"command":"create","path":"","file_text":"a"}]',
  exit: 1,
  stdout: 'error: unsafe \nfailed: 1 of 1 edits\n',
});
add('unsafe before missing', {
  stdin: '../nope.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
  exit: 1,
  stdout: 'error: unsafe ../nope.txt\nfailed: 1 of 1 edits\n',
});
add('unsafe after a/ strip', {
  stdin: '--- a/../etc/passwd\n+++ b/../etc/passwd\n@@ -1 +1 @@\n-a\n+b\n',
  exit: 1,
  stdout: 'error: unsafe ../etc/passwd\nfailed: 1 of 1 edits\n',
});
add('nested create makes dirs', {
  stdin: '[{"command":"create","path":"deep/nested/dir/f.txt","file_text":"hi\\n"}]',
  exit: 0,
  stdout: 'A deep/nested/dir/f.txt\nok: 1 file\n',
  changes: { 'deep/nested/dir/f.txt': 'hi\n' },
});

// ---------------------------------------------------------- matching tiers
add('tier1 trailing ws in file', {
  stdin: 'a.txt\n<<<<<<< SEARCH\nhello\n=======\nhi\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'hello   \n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'hi\n' },
});
add('tier1 trailing ws in patch', {
  stdin: 'a.txt\n<<<<<<< SEARCH\nhello   \n=======\nhi\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'hello\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'hi\n' },
});
add('tier2 indent drift reindent', {
  stdin: 'a.txt\n<<<<<<< SEARCH\n  return x;\n=======\n  return y;\n>>>>>>> REPLACE\n',
  files: { 'a.txt': '    return x;\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': '    return y;\n' },
});
add('tier2 P empty prepends F', {
  stdin: 'a.txt\n<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE\n',
  files: { 'a.txt': '  foo\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': '  bar\n' },
});
add('tier2 blank new line as-is', {
  stdin: 'a.txt\n<<<<<<< SEARCH\n  foo\n=======\n  bar\n\n  baz\n>>>>>>> REPLACE\n',
  files: { 'a.txt': '    foo\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': '    bar\n\n    baz\n' },
});
add('tier2 new line not starting with P as-is', {
  stdin: 'a.txt\n<<<<<<< SEARCH\n  foo\n=======\nx\n>>>>>>> REPLACE\n',
  files: { 'a.txt': '    foo\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'x\n' },
});
add('context line written as file line', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n   return x;\n-  old();\n+  new();\n',
  files: { 'f.txt': '    return x;\n  old();\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': '    return x;\n    new();\n' },
});
add('strict blocks tier1', {
  argv: ['--strict'],
  stdin: 'a.txt\n<<<<<<< SEARCH\nhello\n=======\nhi\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'hello   \n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
});
add('strict allows tier0', {
  argv: ['--strict'],
  stdin: 'a.txt\n<<<<<<< SEARCH\nhello\n=======\nhi\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'hello\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'hi\n' },
});
add('search ambiguous two occurrences', {
  stdin: 'a.txt\n<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'foo\nfoo\n' },
  exit: 1,
  stdout: 'error: ambiguous a.txt\nfailed: 1 of 1 edits\n',
});
add('search ambiguous overlapping', {
  stdin: 'a.txt\n<<<<<<< SEARCH\na\na\n=======\nb\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'a\na\na\n' },
  exit: 1,
  stdout: 'error: ambiguous a.txt\nfailed: 1 of 1 edits\n',
});

// ---------------------------------------------------------- unified hunks
add('unified wrong line numbers nearest wins', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -99,3 +99,3 @@\n line1\n-line2\n+lineX\n line3\n',
  files: { 'f.txt': 'line1\nline2\nline3\nline1\nline2\nline3\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'line1\nline2\nline3\nline1\nlineX\nline3\n' },
});
add('unified nearest tie earlier', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -2,2 +2,2 @@\n x\n-y\n+Y\n',
  files: { 'f.txt': 'x\ny\nx\ny\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'x\nY\nx\ny\n' },
});
add('unified two hunks d offset', {
  stdin:
    '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,3 @@\n a\n+b\n c\n@@ -5,2 +6,1 @@\n d\n-e\n',
  files: { 'f.txt': 'a\nc\nd\ne\nf\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\nb\nc\nd\nf\n' },
});
add('unified empty-O insert at top', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -0,0 +1,2 @@\n+new1\n+new2\n',
  files: { 'f.txt': 'old\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'new1\nnew2\nold\n' },
});
add('unified empty-O insert middle', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -2,0 +3,1 @@\n+mid\n',
  files: { 'f.txt': 'a\nb\nc\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\nb\nmid\nc\n' },
});
add('unified empty-O insert past end', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -99,0 +100,1 @@\n+tail\n',
  files: { 'f.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\nb\ntail\n' },
});
add('unified noeol at end strips break', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n',
  files: { 'f.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\nB' },
});
add('unified noeol mid-file keeps break', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n',
  files: { 'f.txt': 'a\nb\nc\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\nB\nc\n' },
});
add('unified noeol after minus ignored', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+B\n',
  files: { 'f.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\nB\n' },
});
add('unified noeol creates no final break', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n',
  files: { 'f.txt': 'a\nb' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\nB\n' },
});
add('unified create with noeol', {
  stdin: '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n',
  exit: 0,
  stdout: 'A new.txt\nok: 1 file\n',
  changes: { 'new.txt': 'one\ntwo' },
});
add('unified create with break', {
  stdin: '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n',
  exit: 0,
  stdout: 'A new.txt\nok: 1 file\n',
  changes: { 'new.txt': 'one\ntwo\n' },
});
add('unified create empty', {
  stdin: '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,0 @@\n',
  exit: 0,
  stdout: 'A new.txt\nok: 1 file\n',
  changes: { 'new.txt': '' },
});
add('unified create exists', {
  stdin: '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,1 @@\n+x\n',
  files: { 'new.txt': 'old\n' },
  exit: 1,
  stdout: 'error: exists new.txt\nfailed: 1 of 1 edits\n',
});
add('unified delete', {
  stdin: '--- a/gone.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n',
  files: { 'gone.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'D gone.txt\nok: 1 file\n',
  changes: { 'gone.txt': null },
});
add('unified delete missing', {
  stdin: '--- a/gone.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n',
  exit: 1,
  stdout: 'error: missing gone.txt\nfailed: 1 of 1 edits\n',
});
add('unified delete ignores bad hunks', {
  stdin: '--- a/gone.txt\n+++ /dev/null\n@@ -99,9 +0,0 @@\n-zzz\n-yyy\n',
  files: { 'gone.txt': 'a\n' },
  exit: 0,
  stdout: 'D gone.txt\nok: 1 file\n',
  changes: { 'gone.txt': null },
});
add('unified rename R line', {
  stdin: '--- a/old.txt\n+++ b/new.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n',
  files: { 'old.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'R old.txt -> new.txt\nok: 1 file\n',
  changes: { 'old.txt': null, 'new.txt': 'a\nB\n' },
});
add('unified rename missing', {
  stdin: '--- a/old.txt\n+++ b/new.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  exit: 1,
  stdout: 'error: missing old.txt\nfailed: 1 of 1 edits\n',
});
add('unified rename target exists', {
  stdin: '--- a/old.txt\n+++ b/new.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'old.txt': 'a\n', 'new.txt': 'z\n' },
  exit: 1,
  stdout: 'error: exists new.txt\nfailed: 1 of 1 edits\n',
});
add('unified rename via rename lines', {
  stdin: 'diff --git a/old.txt b/new.txt\nrename from old.txt\nrename to new.txt\n--- a/old.txt\n+++ b/new.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'old.txt': 'a\n' },
  exit: 0,
  stdout: 'R old.txt -> new.txt\nok: 1 file\n',
  changes: { 'old.txt': null, 'new.txt': 'A\n' },
});
add('unified rename lines only no dashes', {
  stdin: 'diff --git a/old.txt b/new.txt\nrename from old.txt\nrename to new.txt\nsimilarity index 100%\n',
  files: { 'old.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'R old.txt -> new.txt\nok: 1 file\n',
  changes: { 'old.txt': null, 'new.txt': 'a\nb\n' },
});
add('unified git paths fallback', {
  stdin: 'diff --git a/only.txt b/only.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'only.txt': 'a\n' },
  exit: 0,
  stdout: 'M only.txt\nok: 1 file\n',
  changes: { 'only.txt': 'A\n' },
});
add('unified new file mode', {
  stdin: 'diff --git a/n.txt b/n.txt\nnew file mode 100644\nindex 0000000..1234567\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+hi\n',
  exit: 0,
  stdout: 'A n.txt\nok: 1 file\n',
  changes: { 'n.txt': 'hi\n' },
});
add('unified deleted file mode', {
  stdin: 'diff --git a/g.txt b/g.txt\ndeleted file mode 100644\nindex 1234567..0000000\n--- a/g.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n',
  files: { 'g.txt': 'x\n' },
  exit: 0,
  stdout: 'D g.txt\nok: 1 file\n',
  changes: { 'g.txt': null },
});
add('unified dash without plus plus is prose', {
  stdin: '--- a/f.txt\nnot a plus line\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  exit: 2,
  stdout: 'error: format\n',
});
add('unified hunk before section forced', {
  argv: ['--format=unified'],
  stdin: '@@ -1 +1 @@\n-a\n+A\n',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('unified dash without plus plus in header', {
  stdin: 'diff --git a/f.txt b/f.txt\n--- a/f.txt\nnot a plus line\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  exit: 2,
  stdout: 'error: parse 3\n',
});
add('unified bad diff git line', {
  stdin: 'diff --git a/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('unified bad at line', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -x +1 @@\n-a\n+A\n',
  exit: 2,
  stdout: 'error: parse 3\n',
});
add('unified hunk before section', {
  stdin: '@@ -1 +1 @@\n-a\n+A\n',
  exit: 2,
  stdout: 'error: format\n',
});
add('unified prose and fences ignored', {
  stdin: 'Here is the fix:\n```diff\n--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n```\nDone.\n',
  files: { 'f.txt': 'a\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'A\n' },
});
add('unified hunk header trailing text', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@ function foo\n-a\n+A\n',
  files: { 'f.txt': 'a\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'A\n' },
});
add('unified hunk header no counts', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n',
  files: { 'f.txt': 'a\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'A\n' },
});
add('unified multi file', {
  stdin:
    'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n' +
    'diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1,1 +1,1 @@\n-b\n+B\n',
  files: { 'a.txt': 'a\n', 'b.txt': 'b\n' },
  exit: 0,
  stdout: 'M a.txt\nM b.txt\nok: 2 files\n',
  changes: { 'a.txt': 'A\n', 'b.txt': 'B\n' },
});
add('unified path with tab timestamp', {
  stdin: '--- a/f.txt\t2026-01-01 00:00:00\n+++ b/f.txt\t2026-01-02 00:00:00\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'f.txt': 'a\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'A\n' },
});
add('unified path with spaces', {
  stdin: '--- a/my file.txt\n+++ b/my file.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'my file.txt': 'a\n' },
  exit: 0,
  stdout: 'M my file.txt\nok: 1 file\n',
  changes: { 'my file.txt': 'A\n' },
});
add('unified trailing blank body lines dropped', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n\n\n',
  files: { 'f.txt': 'a\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'A\n' },
});
add('unified crlf preserved', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n',
  files: { 'f.txt': 'a\r\nb\r\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\r\nB\r\n' },
});
add('unified crlf hunk at end adds break', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n',
  files: { 'f.txt': 'a\r\nb' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'a\r\nB\r\n' },
});
add('unified second section after body dashdash', {
  stdin:
    '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n--- a/g.txt\n+++ b/g.txt\n@@ -1,1 +1,1 @@\n-b\n+B\n',
  files: { 'f.txt': 'a\n', 'g.txt': 'b\n' },
  exit: 0,
  stdout: 'M f.txt\nM g.txt\nok: 2 files\n',
  changes: { 'f.txt': 'A\n', 'g.txt': 'B\n' },
});
add('unified hunk nomatch', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-zzz\n+yyy\n',
  files: { 'f.txt': 'a\n' },
  exit: 1,
  stdout: 'error: no-match f.txt\nfailed: 1 of 1 edits\n',
});
add('unified failed hunk changes nothing', {
  stdin:
    '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n@@ -1,1 +1,1 @@\n-zzz\n+yyy\n',
  files: { 'f.txt': 'a\n' },
  exit: 1,
  stdout: 'error: no-match f.txt\nfailed: 1 of 1 edits\n',
});

// ---------------------------------------------------------- SEARCH/REPLACE
add('sr path after code fence', {
  stdin: 'src/app.ts\n```\n<<<<<<< SEARCH\nold();\n=======\nnew();\n>>>>>>> REPLACE\n',
  files: { 'src/app.ts': 'old();\n' },
  exit: 0,
  stdout: 'M src/app.ts\nok: 1 file\n',
  changes: { 'src/app.ts': 'new();\n' },
});
add('sr second block reuses path', {
  stdin:
    'a.txt\n<<<<<<< SEARCH\none\n=======\nuno\n>>>>>>> REPLACE\n' +
    '<<<<<<< SEARCH\ntwo\n=======\ndos\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'uno\ndos\n' },
});
add('sr first block no path parse', {
  stdin: '<<<<<<< SEARCH\none\n=======\nuno\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'one\n' },
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('sr no separator parse', {
  stdin: 'a.txt\n<<<<<<< SEARCH\none\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'one\n' },
  exit: 2,
  stdout: 'error: parse 2\n',
});
add('sr no replace parse', {
  stdin: 'a.txt\n<<<<<<< SEARCH\none\n=======\nuno\n',
  files: { 'a.txt': 'one\n' },
  exit: 2,
  stdout: 'error: parse 2\n',
});
add('sr empty old creates', {
  stdin: 'new.txt\n<<<<<<< SEARCH\n=======\nhello\nworld\n>>>>>>> REPLACE\n',
  exit: 0,
  stdout: 'A new.txt\nok: 1 file\n',
  changes: { 'new.txt': 'hello\nworld\n' },
});
add('sr empty old exists', {
  stdin: 'new.txt\n<<<<<<< SEARCH\n=======\nhello\n>>>>>>> REPLACE\n',
  files: { 'new.txt': 'x\n' },
  exit: 1,
  stdout: 'error: exists new.txt\nfailed: 1 of 1 edits\n',
});
add('sr missing file', {
  stdin: 'nope.txt\n<<<<<<< SEARCH\none\n=======\nuno\n>>>>>>> REPLACE\n',
  exit: 1,
  stdout: 'error: missing nope.txt\nfailed: 1 of 1 edits\n',
});
add('sr markers trailing ws', {
  stdin: 'a.txt\n<<<<<<< SEARCH   \none\n=======  \nuno\n>>>>>>> REPLACE\t\n',
  files: { 'a.txt': 'one\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'uno\n' },
});
add('sr marker leading ws not a marker', {
  stdin: 'a.txt\n  <<<<<<< SEARCH\none\n=======\nuno\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'one\n' },
  exit: 2,
  stdout: 'error: format\n',
});
add('sr crlf preserved', {
  stdin: 'a.txt\n<<<<<<< SEARCH\none\n=======\nuno\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'one\r\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'uno\r\n' },
});
add('sr path is nearest nonblank line', {
  stdin: 'old note\nsome prose\na.txt\n<<<<<<< SEARCH\none\n=======\nuno\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'one\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'uno\n' },
});
add('sr multi file', {
  stdin:
    'a.txt\n<<<<<<< SEARCH\nx\n=======\nX\n>>>>>>> REPLACE\n' +
    'b.txt\n<<<<<<< SEARCH\ny\n=======\nY\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'x\n', 'b.txt': 'y\n' },
  exit: 0,
  stdout: 'M a.txt\nM b.txt\nok: 2 files\n',
  changes: { 'a.txt': 'X\n', 'b.txt': 'Y\n' },
});

// ---------------------------------------------------------------------- V4A
add('v4a basic update noop', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n one\n-two\n+two\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 0,
  stdout: 'ok: 0 files\n',
});
add('v4a update changes text', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'one\nTWO\n' },
});
add('v4a add file', {
  stdin: '*** Begin Patch\n*** Add File: n.txt\n+hello\n+\n+world\n*** End Patch\n',
  exit: 0,
  stdout: 'A n.txt\nok: 1 file\n',
  changes: { 'n.txt': 'hello\n\nworld\n' },
});
add('v4a add exists', {
  stdin: '*** Begin Patch\n*** Add File: n.txt\n+hello\n*** End Patch\n',
  files: { 'n.txt': 'x\n' },
  exit: 1,
  stdout: 'error: exists n.txt\nfailed: 1 of 1 edits\n',
});
add('v4a delete file', {
  stdin: '*** Begin Patch\n*** Delete File: g.txt\n*** End Patch\n',
  files: { 'g.txt': 'x\n' },
  exit: 0,
  stdout: 'D g.txt\nok: 1 file\n',
  changes: { 'g.txt': null },
});
add('v4a delete missing', {
  stdin: '*** Begin Patch\n*** Delete File: g.txt\n*** End Patch\n',
  exit: 1,
  stdout: 'error: missing g.txt\nfailed: 1 of 1 edits\n',
});
add('v4a delete with lines parse', {
  stdin: '*** Begin Patch\n*** Delete File: g.txt\n+oops\n*** End Patch\n',
  files: { 'g.txt': 'x\n' },
  exit: 2,
  stdout: 'error: parse 3\n',
});
add('v4a move to R line', {
  stdin: '*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n@@\n a\n-b\n+B\n*** End Patch\n',
  files: { 'old.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'R old.txt -> new.txt\nok: 1 file\n',
  changes: { 'old.txt': null, 'new.txt': 'a\nB\n' },
});
add('v4a move to same path is update', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n*** Move to: a.txt\n@@\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'one\nTWO\n' },
});
add('v4a move to exists', {
  stdin: '*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n@@\n a\n-b\n+B\n*** End Patch\n',
  files: { 'old.txt': 'a\nb\n', 'new.txt': 'z\n' },
  exit: 1,
  stdout: 'error: exists new.txt\nfailed: 1 of 1 edits\n',
});
add('v4a move only no chunks', {
  stdin: '*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n*** End Patch\n',
  files: { 'old.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'R old.txt -> new.txt\nok: 1 file\n',
  changes: { 'old.txt': null, 'new.txt': 'a\nb\n' },
});
add('v4a update no chunk no move parse', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n*** End Patch\n',
  files: { 'a.txt': 'x\n' },
  exit: 2,
  stdout: 'error: parse 2\n',
});
add('v4a anchor finds second occurrence', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@ marker\n-marker\n+MARKER\n*** End Patch\n',
  files: { 'a.txt': 'marker\nfoo\nmarker\nbar\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'marker\nfoo\nMARKER\nbar\n' },
});
add('v4a anchor then chunk after it', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@ second\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\nsecond\none\ntwo\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'one\ntwo\nsecond\none\nTWO\n' },
});
add('v4a anchor not found', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@ nope\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
});
add('v4a anchor tier2', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@ marker\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': '  marker\n one\n two\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': '  marker\n one\n TWO\n' },
});
add('v4a cursor second chunk after first', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n x\n-y\n+Y\n@@\n x\n-y\n+Y\n*** End Patch\n',
  files: { 'a.txt': 'x\ny\nx\ny\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'x\nY\nx\nY\n' },
});
add('v4a eof chunk must end at last line', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n tail\n-end\n+END\n*** End of File\n*** End Patch\n',
  files: { 'a.txt': 'tail\nend\ntail\nend\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'tail\nend\ntail\nEND\n' },
});
add('v4a eof chunk not at end nomatch', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n mid\n-x\n+X\n*** End of File\n*** End Patch\n',
  files: { 'a.txt': 'mid\nx\nmid\nx\ntail\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
});
add('v4a eof empty-O inserts at end', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n+tail\n*** End of File\n*** End Patch\n',
  files: { 'a.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'a\nb\ntail\n' },
});
add('v4a empty-O inserts at cursor', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@ head\n+ins\n@@\n a\n-b\n+B\n*** End Patch\n',
  files: { 'a.txt': 'head\na\nb\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'head\nins\na\nB\n' },
});
add('v4a first chunk at body line', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'one\nTWO\n' },
});
add('v4a missing begin auto is format', {
  stdin: '*** Update File: a.txt\n@@\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 2,
  stdout: 'error: format\n',
});
add('v4a missing begin forced parse', {
  argv: ['--format=v4a'],
  stdin: '*** Update File: a.txt\n@@\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('v4a empty patch auto is format', { stdin: '\n\n', exit: 2, stdout: 'error: format\n' });
add('v4a empty patch forced parse 1', { argv: ['--format=v4a'], stdin: '\n\n', exit: 2, stdout: 'error: parse 1\n' });
add('v4a missing end', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n one\n-two\n+TWO\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 2,
  stdout: 'error: parse 7\n',
});
add('v4a content after end', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n one\n-two\n+TWO\n*** End Patch\ntrailing\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 2,
  stdout: 'error: parse 9\n',
});
add('v4a stray line parse', {
  stdin: '*** Begin Patch\nhello\n*** End Patch\n',
  exit: 2,
  stdout: 'error: parse 2\n',
});
add('v4a add bad line parse', {
  stdin: '*** Begin Patch\n*** Add File: n.txt\n hello\n*** End Patch\n',
  exit: 2,
  stdout: 'error: parse 3\n',
});
add('v4a move not first parse', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n one\n-two\n+TWO\n*** Move to: b.txt\n*** End Patch\n',
  files: { 'a.txt': 'one\ntwo\n' },
  exit: 2,
  stdout: 'error: parse 7\n',
});
add('v4a blanks between sections ignored', {
  stdin: '*** Begin Patch\n\n*** Add File: n.txt\n+hi\n\n\n*** Delete File: g.txt\n\n*** End Patch\n',
  files: { 'g.txt': 'x\n' },
  exit: 0,
  stdout: 'D g.txt\nA n.txt\nok: 2 files\n',
  changes: { 'n.txt': 'hi\n', 'g.txt': null },
});
add('v4a leading blanks before begin', {
  stdin: '\n\n*** Begin Patch\n*** Add File: n.txt\n+hi\n*** End Patch\n',
  exit: 0,
  stdout: 'A n.txt\nok: 1 file\n',
  changes: { 'n.txt': 'hi\n' },
});
add('v4a crlf preserved', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': 'one\r\ntwo\r\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'one\r\nTWO\r\n' },
});
add('v4a indent tier2', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n   foo\n-  bar\n+  baz\n*** End Patch\n',
  files: { 'a.txt': '    foo\n    bar\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': '    foo\n    baz\n' },
});
add('v4a strict anchor tier0 only', {
  argv: ['--strict'],
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@ marker\n one\n-two\n+TWO\n*** End Patch\n',
  files: { 'a.txt': '  marker\n one\n two\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
});

// --------------------------------------------------------------------- JSON
add('json array two edits', {
  stdin: '[{"command":"create","path":"a.txt","file_text":"one"},{"command":"create","path":"b.txt","file_text":"two"}]',
  exit: 0,
  stdout: 'A a.txt\nA b.txt\nok: 2 files\n',
  changes: { 'a.txt': 'one', 'b.txt': 'two' },
});
add('json lines with blanks', {
  stdin: '\n{"command":"create","path":"a.txt","file_text":"one"}\n\n{"command":"create","path":"b.txt","file_text":"two"}\n',
  exit: 0,
  stdout: 'A a.txt\nA b.txt\nok: 2 files\n',
  changes: { 'a.txt': 'one', 'b.txt': 'two' },
});
add('json create no trailing newline byte for byte', {
  stdin: '[{"command":"create","path":"a.txt","file_text":"hi"}]',
  exit: 0,
  stdout: 'A a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'hi' },
});
add('json create crlf byte for byte', {
  stdin: '[{"command":"create","path":"a.txt","file_text":"a\\r\\nb\\r\\n"}]',
  exit: 0,
  stdout: 'A a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'a\r\nb\r\n' },
});
add('json str_replace ambiguous', {
  stdin: '[{"command":"str_replace","path":"a.txt","old_str":"foo","new_str":"bar"}]',
  files: { 'a.txt': 'foo foo\n' },
  exit: 1,
  stdout: 'error: ambiguous a.txt\nfailed: 1 of 1 edits\n',
});
add('json str_replace overlapping counts', {
  stdin: '[{"command":"str_replace","path":"a.txt","old_str":"aa","new_str":"b"}]',
  files: { 'a.txt': 'aaa\n' },
  exit: 1,
  stdout: 'error: ambiguous a.txt\nfailed: 1 of 1 edits\n',
});
add('json str_replace nomatch', {
  stdin: '[{"command":"str_replace","path":"a.txt","old_str":"zzz","new_str":"bar"}]',
  files: { 'a.txt': 'foo\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
});
add('json str_replace crlf', {
  stdin: '[{"command":"str_replace","path":"a.txt","old_str":"one\\r\\ntwo","new_str":"ONE\\r\\nTWO"}]',
  files: { 'a.txt': 'one\r\ntwo\r\nthree\r\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'ONE\r\nTWO\r\nthree\r\n' },
});
add('json str_replace crlf file lf strings', {
  stdin: '[{"command":"str_replace","path":"a.txt","old_str":"one\\ntwo","new_str":"ONE\\nTWO"}]',
  files: { 'a.txt': 'one\r\ntwo\r\nthree\r\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'ONE\r\nTWO\r\nthree\r\n' },
});
add('json str_replace new_str absent is empty', {
  stdin: '[{"command":"str_replace","path":"a.txt","old_str":"foo"}]',
  files: { 'a.txt': 'foo bar\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': ' bar\n' },
});
add('json insert top', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":0,"new_str":"head"}]',
  files: { 'a.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'head\na\nb\n' },
});
add('json insert at end', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":2,"new_str":"tail"}]',
  files: { 'a.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'a\nb\ntail\n' },
});
add('json insert past end nomatch', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":3,"new_str":"tail"}]',
  files: { 'a.txt': 'a\nb\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
});
add('json insert negative nomatch', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":-1,"new_str":"tail"}]',
  files: { 'a.txt': 'a\nb\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
});
add('json insert empty new_str noop', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":1,"new_str":""}]',
  files: { 'a.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'ok: 0 files\n',
});
add('json insert into empty file', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":0,"new_str":"only"}]',
  files: { 'a.txt': '' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'only' },
});
add('json insert crlf file keeps break', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":1,"new_str":"mid"}]',
  files: { 'a.txt': 'a\r\nb\r\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'a\r\nmid\r\nb\r\n' },
});
add('json wrong command parse', {
  stdin: '[{"command":"delete","path":"a.txt"}]',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('json missing path parse', {
  stdin: '[{"command":"create","file_text":"x"}]',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('json mistyped old_str parse', {
  stdin: '[{"command":"str_replace","path":"a.txt","old_str":5,"new_str":"x"}]',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('json empty old_str parse', {
  stdin: '[{"command":"str_replace","path":"a.txt","old_str":"","new_str":"x"}]',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('json fractional insert_line parse', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":1.5,"new_str":"x"}]',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('json extra keys ignored', {
  stdin: '[{"command":"create","path":"a.txt","file_text":"x","note":"hello"}]',
  exit: 0,
  stdout: 'A a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'x' },
});
add('json array fault line is array start', {
  stdin: '\n\n[{"command":"create","path":"a.txt","file_text":"x"},{"command":"nope","path":"b.txt"}]',
  exit: 2,
  stdout: 'error: parse 3\n',
});
add('json lines fault line is that line', {
  stdin: '{"command":"create","path":"a.txt","file_text":"x"}\nnot json\n{"command":"create","path":"b.txt","file_text":"y"}\n',
  exit: 2,
  stdout: 'error: parse 2\n',
});
add('json single object one line', {
  stdin: '{"command":"create","path":"a.txt","file_text":"x"}',
  exit: 0,
  stdout: 'A a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'x' },
});
add('json pretty object parse', {
  stdin: '{\n  "command": "create",\n  "path": "a.txt",\n  "file_text": "x"\n}\n',
  exit: 2,
  stdout: 'error: parse 1\n',
});
add('json empty array parse 1', { stdin: '[]', exit: 2, stdout: 'error: parse 1\n' });

// ---------------------------------------------------------- order/atomicity
add('first fails second succeeds nothing written', {
  stdin:
    'a.txt\n<<<<<<< SEARCH\nzzz\n=======\nZ\n>>>>>>> REPLACE\n' +
    'b.txt\n<<<<<<< SEARCH\ny\n=======\nY\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'x\n', 'b.txt': 'y\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 2 edits\n',
});
add('two failures in patch order', {
  stdin:
    'b.txt\n<<<<<<< SEARCH\nzzz\n=======\nZ\n>>>>>>> REPLACE\n' +
    'a.txt\n<<<<<<< SEARCH\nyyy\n=======\nY\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'x\n', 'b.txt': 'y\n' },
  exit: 1,
  stdout: 'error: no-match b.txt\nerror: no-match a.txt\nfailed: 2 of 2 edits\n',
});
add('later edit sees created file', {
  stdin:
    '[{"command":"create","path":"a.txt","file_text":"one"},' +
    '{"command":"str_replace","path":"a.txt","old_str":"one","new_str":"uno"}]',
  exit: 0,
  stdout: 'A a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'uno' },
});
add('delete then recreate', {
  stdin:
    '*** Begin Patch\n*** Delete File: a.txt\n*** Add File: a.txt\n+fresh\n*** End Patch\n',
  files: { 'a.txt': 'old\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'fresh\n' },
});
add('check mode failing edit no writes', {
  argv: ['--check'],
  stdin:
    'a.txt\n<<<<<<< SEARCH\nzzz\n=======\nZ\n>>>>>>> REPLACE\n' +
    'b.txt\n<<<<<<< SEARCH\ny\n=======\nY\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'x\n', 'b.txt': 'y\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 2 edits\n',
});
add('check mode success no writes', {
  argv: ['--check'],
  stdin: 'a.txt\n<<<<<<< SEARCH\nx\n=======\nX\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'x\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
});
add('move then new path deleted no R', {
  stdin:
    '*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n@@\n a\n-b\n+B\n*** Delete File: new.txt\n*** End Patch\n',
  files: { 'old.txt': 'a\nb\n' },
  exit: 0,
  stdout: 'D old.txt\nok: 1 file\n',
  changes: { 'old.txt': null },
});
add('R sorts by new path', {
  stdin:
    '*** Begin Patch\n*** Update File: z.txt\n*** Move to: a.txt\n@@\n x\n-y\n+Y\n*** Update File: b.txt\n*** Move to: c.txt\n@@\n p\n-q\n+Q\n*** End Patch\n',
  files: { 'z.txt': 'x\ny\n', 'b.txt': 'p\nq\n' },
  exit: 0,
  stdout: 'R z.txt -> a.txt\nR b.txt -> c.txt\nok: 2 files\n',
  changes: { 'z.txt': null, 'a.txt': 'x\nY\n', 'b.txt': null, 'c.txt': 'p\nQ\n' },
});



// ---------------------------------------------------------- extra edges
add('unified hunk not at end keeps no-break', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'f.txt': 'a\nb\nc' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'A\nb\nc' },
});
add('unified hunk not at end keeps break', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'f.txt': 'a\nb\nc\n' },
  exit: 0,
  stdout: 'M f.txt\nok: 1 file\n',
  changes: { 'f.txt': 'A\nb\nc\n' },
});
add('v4a update keeps no final break', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n-a\n+A\n*** End Patch\n',
  files: { 'a.txt': 'a\nb' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'A\nb' },
});
add('v4a anchor tier from cursor', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@ marker\n-x\n+X\n@@ marker\n-y\n+Y\n*** End Patch\n',
  files: { 'a.txt': 'marker\nx\n  marker\ny\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'marker\nX\n  marker\nY\n' },
});
add('v4a anchor spaces trimmed', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@   marker   \n-x\n+X\n*** End Patch\n',
  files: { 'a.txt': 'marker\nx\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'marker\nX\n' },
});
add('unified strip one a-prefix only', {
  stdin: '--- a/b/foo.txt\n+++ b/b/foo.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'b/foo.txt': 'a\n' },
  exit: 0,
  stdout: 'M b/foo.txt\nok: 1 file\n',
  changes: { 'b/foo.txt': 'A\n' },
});
add('unified change same path no a prefix', {
  stdin: '--- foo.txt\n+++ foo.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'foo.txt': 'a\n' },
  exit: 0,
  stdout: 'M foo.txt\nok: 1 file\n',
  changes: { 'foo.txt': 'A\n' },
});
add('unified empty file change nomatch', {
  stdin: '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  files: { 'f.txt': '' },
  exit: 1,
  stdout: 'error: no-match f.txt\nfailed: 1 of 1 edits\n',
});
add('json insert at line count into crlf', {
  stdin: '[{"command":"insert","path":"a.txt","insert_line":2,"new_str":"c"}]',
  files: { 'a.txt': 'a\r\nb' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'a\r\nb\r\nc' },
});
add('sr delete lines only', {
  stdin: 'a.txt\n<<<<<<< SEARCH\nb\n=======\n>>>>>>> REPLACE\n',
  files: { 'a.txt': 'a\nb\nc\n' },
  exit: 0,
  stdout: 'M a.txt\nok: 1 file\n',
  changes: { 'a.txt': 'a\nc\n' },
});
add('v4a chunk after eof chunk needs new anchor', {
  stdin: '*** Begin Patch\n*** Update File: a.txt\n@@\n a\n-b\n+B\n*** End of File\n@@\n c\n-d\n+D\n*** End Patch\n',
  files: { 'a.txt': 'a\nb\nc\nd\n' },
  exit: 1,
  stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
});

// ------------------------------------------------------------------ runner
let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = runCheck({ id: c.name, argv: c.argv, stdin: c.stdin, files: c.files });
  const wantFiles = { ...c.files };
  for (const [p, v] of Object.entries(c.expect.changes)) {
    if (v === null) delete wantFiles[p];
    else wantFiles[p] = v;
  }
  const problems = [];
  if (got.exit !== c.expect.exit) problems.push(`exit ${got.exit}, expected ${c.expect.exit}`);
  if (got.stdout !== c.expect.stdout)
    problems.push(`stdout ${JSON.stringify(got.stdout)}, expected ${JSON.stringify(c.expect.stdout)}`);
  for (const p of new Set([...Object.keys(wantFiles), ...Object.keys(got.files)])) {
    if (wantFiles[p] === undefined) problems.push(`${p} should not exist (got ${JSON.stringify(got.files[p])})`);
    else if (got.files[p] === undefined) problems.push(`${p} is missing`);
    else if (got.files[p] !== wantFiles[p])
      problems.push(`${p} differs: expected ${JSON.stringify(wantFiles[p])}, got ${JSON.stringify(got.files[p])}`);
  }
  if (problems.length === 0) pass += 1;
  else {
    fail += 1;
    process.stdout.write(`FAIL ${c.name}\n  ${problems.join('\n  ')}\n`);
  }
}
process.stdout.write(`${pass} passed, ${fail} failed, of ${cases.length} adversarial cases\n`);
