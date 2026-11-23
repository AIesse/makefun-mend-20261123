// mend — one patch tool for every AI edit format.
//
// An AI model writes an edit in one of four shapes: a unified diff (whose line
// numbers are often wrong), SEARCH/REPLACE blocks, a V4A patch, or text-editor
// tool calls as JSON. mend reads whichever shape it is given, finds the lines
// the edit names even when their whitespace or indentation drifted, and
// changes every file the edit touches or none of them. The whole behaviour is
// SPEC.md version 1, in this repository beside this file.
//
// Node 22 and its standard library alone; run as `node main.ts [options] [PATCH]`.
// A trial hands over to runner.ts when MAKEFUN_ENV_URL is set (the last lines
// below); keep that hand-over and runner.ts as they are.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/** A failure that ends the run with exit 2 and one line of output. */
class ParseFault extends Error {
  line: string;
  constructor(line: string) {
    super(line);
    this.line = line;
  }
}

/** One edit failed; the run ends with exit 1 and one line per failure. */
class EditFault extends Error {
  code: string;
  path: string;
  constructor(code: string, path: string) {
    super(`${code} ${path}`);
    this.code = code;
    this.path = path;
  }
}

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

/** A line with nothing on it but whitespace. */
function isBlank(s: string): boolean {
  return s.trim() === '';
}

/** The patch's lines: split at \n, one trailing \r off each, and no empty piece after a final \n. */
function splitPatchLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (text.endsWith('\n')) parts.pop();
  return parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** Trailing whitespace off a line (for marker matching). */
function trimEndWs(s: string): string {
  return s.replace(/\s+$/, '');
}

/** A path is safe when it is not empty, does not start with /, holds no \, and none of its segments is empty, . or ... */
function isSafePath(p: string): boolean {
  if (p === '' || p.startsWith('/') || p.includes('\\')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Byte order of two paths, as UTF-8. */
function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** A file as lines: its line break, whether it ends with one, and its lines. */
interface FileDoc {
  lines: string[];
  br: '\n' | '\r\n';
  final: boolean;
}

function parseDoc(text: string): FileDoc {
  if (text === '') return { lines: [], br: '\n', final: false };
  const nl = text.indexOf('\n');
  const br: '\n' | '\r\n' = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const final = text.endsWith(br);
  if (final) parts.pop();
  return { lines: parts, br, final };
}

function writeDoc(doc: FileDoc): string {
  if (doc.lines.length === 0) return '';
  return doc.lines.join(doc.br) + (doc.final ? doc.br : '');
}

/**
 * The tree as the edits leave it. `before` holds what each touched path held
 * on disk (raw text and parsed form); `after` holds what it holds now (null:
 * deleted). A path is only read from disk the first time an edit looks at it.
 */
class WorkTree {
  origText = new Map<string, string | null>();
  origDoc = new Map<string, FileDoc | null>();
  after = new Map<string, FileDoc | null>();
  moves: Array<[string, string]> = [];

  read(p: string): FileDoc | null {
    if (!this.origDoc.has(p)) {
      let text: string | null = null;
      try {
        if (statSync(p).isFile()) text = readFileSync(p, 'utf8');
      } catch {
        text = null;
      }
      this.origText.set(p, text);
      this.origDoc.set(p, text === null ? null : parseDoc(text));
    }
    return this.origDoc.get(p)!;
  }

  rawBefore(p: string): string | null {
    this.read(p);
    return this.origText.get(p)!;
  }

  get(p: string): FileDoc | null {
    return this.after.has(p) ? this.after.get(p)! : this.read(p);
  }

  put(p: string, doc: FileDoc | null): void {
    this.after.set(p, doc);
  }

  snapshot(): Map<string, FileDoc | null> {
    return new Map(this.after);
  }

  restore(snap: Map<string, FileDoc | null>): void {
    this.after.clear();
    for (const [k, v] of snap) this.after.set(k, v);
  }
}

type Edit = (tree: WorkTree) => void;

// ---------------------------------------------------------------- matching

function trimRightSpaces(s: string): string {
  return s.replace(/[ \t]+$/, '');
}

function trimBothSpaces(s: string): string {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

/** One file line against one old line, at a tier (0 exact, 1 trailing-trimmed, 2 both-trimmed). */
function lineMatches(fileLine: string, oldLine: string, tier: number): boolean {
  if (tier === 0) return fileLine === oldLine;
  if (tier === 1) return trimRightSpaces(fileLine) === trimRightSpaces(oldLine);
  return trimBothSpaces(fileLine) === trimBothSpaces(oldLine);
}

/** Every 0-based position where old occurs in lines at a tier; occurrences may overlap. */
function spotsAt(lines: string[], old: string[], tier: number): number[] {
  const spots: number[] = [];
  for (let i = 0; i + old.length <= lines.length; i++) {
    let good = true;
    for (let j = 0; j < old.length; j++) {
      if (!lineMatches(lines[i + j]!, old[j]!, tier)) {
        good = false;
        break;
      }
    }
    if (good) spots.push(i);
  }
  return spots;
}

/** The first tier at which old occurs at least once, anywhere in the file. */
function locateOld(lines: string[], old: string[], strict: boolean): { tier: number; spots: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const spots = spotsAt(lines, old, tier);
    if (spots.length > 0) return { tier, spots };
  }
  return null;
}

/** The first tier at which old occurs at least once at or after `from`; only those spots. */
function locateFrom(lines: string[], old: string[], strict: boolean, from: number): { tier: number; spots: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const spots = spotsAt(lines, old, tier).filter((s) => s >= from);
    if (spots.length > 0) return { tier, spots };
  }
  return null;
}

function leadingWs(s: string): string {
  const m = /^[ \t]*/.exec(s);
  return m === null ? '' : m[0];
}

/** Re-indent one new line at tier 2: its leading spaces and tabs, when it starts with the old first line's, become the file first line's. */
function reindent(line: string, from: string, to: string): string {
  if (line === '' || line.trim() === '') return line;
  if (!line.startsWith(from)) return line;
  return to + line.slice(from.length);
}

/** One line of N: a context line is written as the file's own matched line; any other line is new. */
interface FreshLine {
  text: string;
  context: boolean;
  oldIndex: number;
}

/** Replace old.length lines at `at` with fresh, honouring the tier-2 re-indent. The final break is the caller's. */
function replaceLines(doc: FileDoc, at: number, old: string[], fresh: FreshLine[], tier: number): FileDoc {
  const from = leadingWs(old[0]!);
  const to = leadingWs(doc.lines[at] ?? '');
  const out: string[] = doc.lines.slice(0, at);
  for (const f of fresh) {
    if (f.context) out.push(doc.lines[at + f.oldIndex]!);
    else if (tier === 2) out.push(reindent(f.text, from, to));
    else out.push(f.text);
  }
  out.push(...doc.lines.slice(at + old.length));
  return { lines: out, br: doc.br, final: doc.final };
}

/** One body line of a unified hunk or a V4A chunk. */
type BodyLine =
  | { kind: 'context'; text: string }
  | { kind: 'old'; text: string }
  | { kind: 'new'; text: string }
  | { kind: 'backslash' };

/** Split a hunk or chunk body into its old lines O and its new lines N (with context flags). */
function bodyLines(body: BodyLine[]): { o: string[]; n: FreshLine[] } {
  const o: string[] = [];
  const n: FreshLine[] = [];
  for (const b of body) {
    if (b.kind === 'context') {
      const idx = o.length;
      o.push(b.text);
      n.push({ text: b.text, context: true, oldIndex: idx });
    } else if (b.kind === 'old') {
      o.push(b.text);
    } else if (b.kind === 'new') {
      n.push({ text: b.text, context: false, oldIndex: -1 });
    }
  }
  return { o, n };
}

/** Whether a `\` line follows the last body line of one of the given kinds. */
function backslashAfter(body: BodyLine[], kinds: Array<'context' | 'new'>): boolean {
  let last = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i]!.kind === 'context' || body[i]!.kind === 'new') {
      if (kinds.includes(body[i]!.kind as 'context' | 'new')) last = i;
    }
  }
  if (last < 0) return false;
  return body[last + 1] !== undefined && body[last + 1]!.kind === 'backslash';
}

// ------------------------------------------------------------- format detect

function detectFormat(lines: string[]): string | null {
  const first = lines.findIndex((l) => !isBlank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => trimEndWs(l) === '<<<<<<< SEARCH')) return 'search-replace';
  if (
    lines.some(
      (l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')),
    )
  )
    return 'unified';
  return null;
}

// --------------------------------------------------------------------- JSON

/** One JSON edit object, or null when it is not one (a parse fault). */
function jsonToEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== 'string') return null;
  const p = o.path;
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!isSafePath(p)) throw new EditFault('unsafe', p);
      if (tree.get(p) !== null) throw new EditFault('exists', p);
      tree.put(p, parseDoc(text));
    };
  }
  if (
    o.command === 'str_replace' &&
    typeof o.old_str === 'string' &&
    o.old_str !== '' &&
    (o.new_str === undefined || typeof o.new_str === 'string')
  ) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      if (!isSafePath(p)) throw new EditFault('unsafe', p);
      const doc = tree.get(p);
      if (doc === null) throw new EditFault('missing', p);
      const before = writeDoc(doc);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const norm = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const text = norm(before);
      const old = norm(oldStr);
      const nw = norm(newStr);
      let count = 0;
      for (let k = text.indexOf(old); k >= 0; k = text.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new EditFault('no-match', p);
      if (count > 1) throw new EditFault('ambiguous', p);
      const at = text.indexOf(old);
      const out = text.slice(0, at) + nw + text.slice(at + old.length);
      tree.put(p, parseDoc(crlf ? out.replaceAll('\n', '\r\n') : out));
    };
  }
  if (
    o.command === 'insert' &&
    typeof o.insert_line === 'number' &&
    Number.isInteger(o.insert_line) &&
    typeof o.new_str === 'string'
  ) {
    const line = o.insert_line;
    const add = splitPatchLines(o.new_str);
    return (tree) => {
      if (!isSafePath(p)) throw new EditFault('unsafe', p);
      const doc = tree.get(p);
      if (doc === null) throw new EditFault('missing', p);
      if (line < 0 || line > doc.lines.length) throw new EditFault('no-match', p);
      const lines = [...doc.lines.slice(0, line), ...add, ...doc.lines.slice(line)];
      tree.put(p, { lines, br: doc.br, final: doc.final });
    };
  }
  return null;
}

function parseJson(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !isBlank(l));
  if (first < 0) throw new ParseFault('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new ParseFault(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new ParseFault(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonToEdit(x);
      if (e === null) throw new ParseFault(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (isBlank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonToEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new ParseFault(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

// ------------------------------------------------------------------ unified

interface RawHunk {
  a: number;
  body: BodyLine[];
}

interface RawSection {
  oldPath: string | null;
  newPath: string | null;
  oldSrc: 'git' | 'rename' | 'pair';
  newSrc: 'git' | 'rename' | 'pair';
  createFlag: boolean;
  deleteFlag: boolean;
  hunks: RawHunk[];
}

/** A path from a `--- ` or `+++ ` header line: up to the first tab, spaces off, one a/ or b/ off, /dev/null is no file. */
function cleanHeaderPath(raw: string): string | null {
  let p = raw.split('\t')[0]!.trim();
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  if (p === '/dev/null') return null;
  return p;
}

/** A path from a `rename from/to` header line: spaces off, /dev/null is no file. */
function cleanRenamePath(raw: string): string | null {
  const p = raw.trim();
  if (p === '/dev/null') return null;
  return p;
}

function gitPaths(line: string, no: number): { old: string; new: string } {
  const m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
  if (m === null) throw new ParseFault(`error: parse ${no}`);
  return { old: m[1]!, new: m[2]! };
}

function readHunk(lines: string[], at: number): { hunk: RawHunk; next: number } {
  const head = lines[at]!;
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(head);
  if (m === null) throw new ParseFault(`error: parse ${at + 1}`);
  const a = Number(m[1]);
  const body: BodyLine[] = [];
  let j = at + 1;
  while (j < lines.length) {
    const l = lines[j]!;
    if (l.startsWith('diff --git ')) break;
    if (l.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
    if (l === '') body.push({ kind: 'context', text: '' });
    else if (l.startsWith(' ')) body.push({ kind: 'context', text: l.slice(1) });
    else if (l.startsWith('-')) body.push({ kind: 'old', text: l.slice(1) });
    else if (l.startsWith('+')) body.push({ kind: 'new', text: l.slice(1) });
    else if (l.startsWith('\\')) body.push({ kind: 'backslash' });
    else break;
    j += 1;
  }
  while (body.length > 0) {
    const last = body[body.length - 1]!;
    if (last.kind === 'context' && last.text === '') body.pop();
    else break;
  }
  return { hunk: { a, body }, next: j };
}

function parseUnified(lines: string[]): RawSection[] {
  const sections: RawSection[] = [];
  let sec: RawSection | null = null;
  let headerPair = false;
  let seenHunk = false;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const g = gitPaths(line, i + 1);
      sec = {
        oldPath: g.old,
        newPath: g.new,
        oldSrc: 'git',
        newSrc: 'git',
        createFlag: false,
        deleteFlag: false,
        hunks: [],
      };
      sections.push(sec);
      headerPair = false;
      seenHunk = false;
      i += 1;
      continue;
    }
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      if (sec !== null && !seenHunk && !headerPair) {
        sec.oldPath = cleanHeaderPath(line.slice(4));
        sec.newPath = cleanHeaderPath(lines[i + 1]!.slice(4));
        sec.oldSrc = 'pair';
        sec.newSrc = 'pair';
        headerPair = true;
        i += 2;
        continue;
      }
      sec = {
        oldPath: cleanHeaderPath(line.slice(4)),
        newPath: cleanHeaderPath(lines[i + 1]!.slice(4)),
        oldSrc: 'pair',
        newSrc: 'pair',
        createFlag: false,
        deleteFlag: false,
        hunks: [],
      };
      sections.push(sec);
      headerPair = true;
      seenHunk = false;
      i += 2;
      continue;
    }
    if (line.startsWith('--- ') && sec !== null && !seenHunk) {
      throw new ParseFault(`error: parse ${i + 2}`);
    }
    if (line.startsWith('@@')) {
      if (sec === null) throw new ParseFault(`error: parse ${i + 1}`);
      const h = readHunk(lines, i);
      sec.hunks.push(h.hunk);
      seenHunk = true;
      i = h.next;
      continue;
    }
    if (sec !== null && !seenHunk) {
      if (line.startsWith('rename from ')) {
        if (sec.oldSrc !== 'pair') {
          sec.oldPath = cleanRenamePath(line.slice('rename from '.length));
          sec.oldSrc = 'rename';
        }
      } else if (line.startsWith('rename to ')) {
        if (sec.newSrc !== 'pair') {
          sec.newPath = cleanRenamePath(line.slice('rename to '.length));
          sec.newSrc = 'rename';
        }
      } else if (line === 'new file mode' || line.startsWith('new file mode ')) {
        sec.createFlag = true;
      } else if (line === 'deleted file mode' || line.startsWith('deleted file mode ')) {
        sec.deleteFlag = true;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return sections;
}

/** Apply a section's hunks in order to a file's lines; d is the running length delta. */
function applyHunks(doc: FileDoc, hunks: RawHunk[], strict: boolean, path: string): FileDoc {
  let cur = doc;
  let d = 0;
  for (const hunk of hunks) {
    const { o, n } = bodyLines(hunk.body);
    if (o.length === 0) {
      let at = hunk.a + d;
      if (at < 0) at = 0;
      if (at > cur.lines.length) at = cur.lines.length;
      const atEnd = at === cur.lines.length;
      const inserted = n.map((f) => f.text);
      const lines = [...cur.lines.slice(0, at), ...inserted, ...cur.lines.slice(at)];
      let fin = cur.final;
      if (atEnd) fin = !backslashAfter(hunk.body, ['context', 'new']);
      cur = { lines, br: cur.br, final: fin };
      d += n.length;
    } else {
      const found = locateOld(cur.lines, o, strict);
      if (found === null) throw new EditFault('no-match', path);
      const target = hunk.a - 1 + d;
      let best = found.spots[0]!;
      for (const s of found.spots) {
        if (Math.abs(s - target) < Math.abs(best - target)) best = s;
      }
      const at = best;
      const replaced = replaceLines(cur, at, o, n, found.tier);
      let fin = cur.final;
      if (at + o.length >= cur.lines.length) fin = !backslashAfter(hunk.body, ['context', 'new']);
      cur = { lines: replaced.lines, br: replaced.br, final: fin };
      d += n.length - o.length;
    }
  }
  return cur;
}

function unifiedEdit(sec: RawSection, strict: boolean): Edit {
  const oldP = sec.oldPath;
  const newP = sec.newPath;
  const create = oldP === null || sec.createFlag;
  const del = newP === null || sec.deleteFlag;
  if (create) {
    if (newP === null) return () => {};
    const plus: string[] = [];
    for (const h of sec.hunks) {
      for (const b of h.body) {
        if (b.kind === 'new') plus.push(b.text);
      }
    }
    let lastPlus: { hunk: RawHunk; idx: number } | null = null;
    for (const h of sec.hunks) {
      for (let k = 0; k < h.body.length; k++) {
        if (h.body[k]!.kind === 'new') lastPlus = { hunk: h, idx: k };
      }
    }
    let fin = false;
    if (lastPlus !== null) {
      const next = lastPlus.hunk.body[lastPlus.idx + 1];
      fin = !(next !== undefined && next.kind === 'backslash');
    }
    return (tree) => {
      if (!isSafePath(newP)) throw new EditFault('unsafe', newP);
      if (tree.get(newP) !== null) throw new EditFault('exists', newP);
      tree.put(newP, { lines: plus, br: '\n', final: fin });
    };
  }
  if (del) {
    const p = oldP!;
    return (tree) => {
      if (!isSafePath(p)) throw new EditFault('unsafe', p);
      if (tree.get(p) === null) throw new EditFault('missing', p);
      tree.put(p, null);
    };
  }
  if (oldP !== newP) {
    const from = oldP!;
    const to = newP!;
    return (tree) => {
      if (!isSafePath(from)) throw new EditFault('unsafe', from);
      if (!isSafePath(to)) throw new EditFault('unsafe', to);
      const doc = tree.get(from);
      if (doc === null) throw new EditFault('missing', from);
      if (tree.get(to) !== null) throw new EditFault('exists', to);
      const next = applyHunks(doc, sec.hunks, strict, from);
      tree.put(from, null);
      tree.put(to, next);
      tree.moves.push([from, to]);
    };
  }
  const p = oldP!;
  return (tree) => {
    if (!isSafePath(p)) throw new EditFault('unsafe', p);
    const doc = tree.get(p);
    if (doc === null) throw new EditFault('missing', p);
    tree.put(p, applyHunks(doc, sec.hunks, strict, p));
  };
}

// ---------------------------------------------------------- SEARCH/REPLACE

function searchReplaceEdit(path: string, oldLines: string[], newLines: string[], strict: boolean): Edit {
  return (tree) => {
    if (!isSafePath(path)) throw new EditFault('unsafe', path);
    if (oldLines.length === 0) {
      if (tree.get(path) !== null) throw new EditFault('exists', path);
      tree.put(path, { lines: [...newLines], br: '\n', final: true });
      return;
    }
    const doc = tree.get(path);
    if (doc === null) throw new EditFault('missing', path);
    const found = locateOld(doc.lines, oldLines, strict);
    if (found === null) throw new EditFault('no-match', path);
    if (found.spots.length > 1) throw new EditFault('ambiguous', path);
    const at = found.spots[0]!;
    const fresh: FreshLine[] = newLines.map((t) => ({ text: t, context: false, oldIndex: -1 }));
    tree.put(path, replaceLines(doc, at, oldLines, fresh, found.tier));
  };
}

function parseSearchReplace(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevPath: string | null = null;
  let prevEnd = -1;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    if (trimEndWs(lines[i]!) !== '<<<<<<< SEARCH') {
      i += 1;
      continue;
    }
    const searchNo = i + 1;
    let path: string | null = null;
    for (let j = i - 1; j > prevEnd; j--) {
      const l = lines[j]!;
      if (isBlank(l)) continue;
      if (l.trim().startsWith('```')) continue;
      path = l.trim();
      break;
    }
    if (path === null) {
      if (prevPath === null) throw new ParseFault(`error: parse ${searchNo}`);
      path = prevPath;
    }
    let sep = -1;
    for (let j = i + 1; j < n; j++) {
      if (trimEndWs(lines[j]!) === '=======') {
        sep = j;
        break;
      }
      if (trimEndWs(lines[j]!) === '<<<<<<< SEARCH') break;
    }
    if (sep < 0) throw new ParseFault(`error: parse ${searchNo}`);
    let end = -1;
    for (let j = sep + 1; j < n; j++) {
      if (trimEndWs(lines[j]!) === '>>>>>>> REPLACE') {
        end = j;
        break;
      }
      if (trimEndWs(lines[j]!) === '<<<<<<< SEARCH') break;
    }
    if (end < 0) throw new ParseFault(`error: parse ${searchNo}`);
    edits.push(searchReplaceEdit(path, lines.slice(i + 1, sep), lines.slice(sep + 1, end), strict));
    prevPath = path;
    prevEnd = end;
    i = end + 1;
  }
  return edits;
}

// ---------------------------------------------------------------------- V4A

interface V4aChunk {
  anchor: string | null;
  body: BodyLine[];
  eof: boolean;
}

function v4aUpdateEdit(path: string, moveTo: string | null, chunks: V4aChunk[], strict: boolean): Edit {
  const isMove = moveTo !== null && moveTo !== path;
  return (tree) => {
    if (!isSafePath(path)) throw new EditFault('unsafe', path);
    if (isMove && !isSafePath(moveTo!)) throw new EditFault('unsafe', moveTo!);
    const doc = tree.get(path);
    if (doc === null) throw new EditFault('missing', path);
    if (isMove && tree.get(moveTo!) !== null) throw new EditFault('exists', moveTo!);
    let cur = doc;
    let cursor = 0;
    for (const chunk of chunks) {
      const { o, n } = bodyLines(chunk.body);
      if (chunk.anchor !== null) {
        const found = locateFrom(cur.lines, [chunk.anchor], strict, cursor);
        if (found === null) throw new EditFault('no-match', path);
        cursor = found.spots[0]! + 1;
      }
      if (o.length === 0) {
        const at = chunk.eof ? cur.lines.length : cursor;
        const inserted = n.map((f) => f.text);
        const lines = [...cur.lines.slice(0, at), ...inserted, ...cur.lines.slice(at)];
        cur = { lines, br: cur.br, final: cur.final };
        cursor = at + inserted.length;
      } else {
        const found = locateFrom(cur.lines, o, strict, cursor);
        if (found === null) throw new EditFault('no-match', path);
        let at = -1;
        for (const s of found.spots) {
          if (chunk.eof && s + o.length !== cur.lines.length) continue;
          at = s;
          break;
        }
        if (at < 0) throw new EditFault('no-match', path);
        cur = replaceLines(cur, at, o, n, found.tier);
        cursor = at + n.length;
      }
    }
    if (isMove) {
      tree.put(path, null);
      tree.put(moveTo!, cur);
      tree.moves.push([path, moveTo!]);
    } else {
      tree.put(path, cur);
    }
  };
}

function parseV4a(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !isBlank(l));
  if (first < 0) throw new ParseFault('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new ParseFault(`error: parse ${first + 1}`);
  let last = -1;
  for (let k = lines.length - 1; k >= 0; k--) {
    if (!isBlank(lines[k]!)) {
      last = k;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new ParseFault(`error: parse ${lines.length + 1}`);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    if (line.startsWith('*** Add File: ') || line.startsWith('*** Delete File: ') || line.startsWith('*** Update File: ')) {
      const isAdd = line.startsWith('*** Add File: ');
      const isDel = line.startsWith('*** Delete File: ');
      const headerNo = i + 1;
      const path = line.slice(line.indexOf(': ') + 2).trim();
      let j = i + 1;
      while (j < last) {
        const l = lines[j]!;
        if (
          l.startsWith('*** Add File: ') ||
          l.startsWith('*** Delete File: ') ||
          l.startsWith('*** Update File: ') ||
          l.trim() === '*** End Patch'
        )
          break;
        j += 1;
      }
      let end = j;
      while (end > i + 1 && isBlank(lines[end - 1]!)) end -= 1;
      if (isAdd) {
        const fileLines: string[] = [];
        for (let k = i + 1; k < end; k++) {
          const l = lines[k]!;
          if (l === '') fileLines.push('');
          else if (l.startsWith('+')) fileLines.push(l.slice(1));
          else throw new ParseFault(`error: parse ${k + 1}`);
        }
        const p = path;
        edits.push((tree) => {
          if (!isSafePath(p)) throw new EditFault('unsafe', p);
          if (tree.get(p) !== null) throw new EditFault('exists', p);
          tree.put(p, { lines: fileLines, br: '\n', final: true });
        });
      } else if (isDel) {
        if (end > i + 1) throw new ParseFault(`error: parse ${i + 2}`);
        const p = path;
        edits.push((tree) => {
          if (!isSafePath(p)) throw new EditFault('unsafe', p);
          if (tree.get(p) === null) throw new EditFault('missing', p);
          tree.put(p, null);
        });
      } else {
        let moveTo: string | null = null;
        let k = i + 1;
        if (k < end && lines[k]!.startsWith('*** Move to: ')) {
          moveTo = lines[k]!.slice('*** Move to: '.length).trim();
          k += 1;
        }
        const chunks: V4aChunk[] = [];
        let cur: V4aChunk | null = null;
        while (k < end) {
          const l = lines[k]!;
          if (l.startsWith('@@')) {
            if (cur !== null) chunks.push(cur);
            const anchor = l.slice(2).trim();
            cur = { anchor: anchor === '' ? null : anchor, body: [], eof: false };
            k += 1;
            continue;
          }
          if (l.trim() === '*** End of File') {
            if (cur === null) throw new ParseFault(`error: parse ${k + 1}`);
            cur.eof = true;
            chunks.push(cur);
            cur = null;
            k += 1;
            continue;
          }
          if (l === '' || l.startsWith(' ') || l.startsWith('-') || l.startsWith('+')) {
            if (cur === null) {
              if (chunks.length > 0) throw new ParseFault(`error: parse ${k + 1}`);
              cur = { anchor: null, body: [], eof: false };
            }
            if (l === '') cur.body.push({ kind: 'context', text: '' });
            else if (l.startsWith(' ')) cur.body.push({ kind: 'context', text: l.slice(1) });
            else if (l.startsWith('-')) cur.body.push({ kind: 'old', text: l.slice(1) });
            else cur.body.push({ kind: 'new', text: l.slice(1) });
            k += 1;
            continue;
          }
          throw new ParseFault(`error: parse ${k + 1}`);
        }
        if (cur !== null) chunks.push(cur);
        if (chunks.length === 0 && moveTo === null) throw new ParseFault(`error: parse ${headerNo}`);
        edits.push(v4aUpdateEdit(path, moveTo, chunks, strict));
      }
      i = j;
      continue;
    }
    throw new ParseFault(`error: parse ${i + 1}`);
  }
  return edits;
}

// ------------------------------------------------------------ command line

interface Cli {
  format: string;
  check: boolean;
  strict: boolean;
  patch: string | null;
}

function parseCli(args: string[]): Cli {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') {
      ended = true;
      continue;
    }
    if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=')) {
        if (format !== null) throw new ParseFault('error: usage');
        const v = a.slice('--format='.length);
        if (!FORMATS.includes(v)) throw new ParseFault('error: usage');
        format = v;
      } else if (a === '--check') {
        if (check) throw new ParseFault('error: usage');
        check = true;
      } else if (a === '--strict') {
        if (strict) throw new ParseFault('error: usage');
        strict = true;
      } else {
        throw new ParseFault('error: usage');
      }
    } else {
      pos.push(a);
    }
  }
  if (pos.length > 1) throw new ParseFault('error: usage');
  return {
    format: format ?? 'auto',
    check,
    strict,
    patch: pos.length === 0 || pos[0] === '-' ? null : pos[0]!,
  };
}

// --------------------------------------------------------------------- run

function buildRows(tree: WorkTree): string[] {
  const kind = new Map<string, 'A' | 'D' | 'M'>();
  for (const p of tree.after.keys()) {
    const was = tree.rawBefore(p);
    const now = tree.after.get(p)!;
    const nowText = now === null ? null : writeDoc(now);
    if (was === nowText) continue;
    kind.set(p, was === null ? 'A' : now === null ? 'D' : 'M');
  }
  const rows: Array<{ key: string; text: string }> = [];
  for (const [oldP, newP] of tree.moves) {
    if (kind.get(oldP) === 'D' && kind.get(newP) === 'A') {
      kind.delete(oldP);
      kind.delete(newP);
      rows.push({ key: newP, text: `R ${oldP} -> ${newP}` });
    }
  }
  for (const [p, k] of kind) rows.push({ key: p, text: `${k} ${p}` });
  rows.sort((a, b) => byteOrder(a.key, b.key));
  return rows.map((r) => r.text);
}

function writeTree(tree: WorkTree): void {
  for (const p of tree.after.keys()) {
    const was = tree.rawBefore(p);
    const now = tree.after.get(p)!;
    const nowText = now === null ? null : writeDoc(now);
    if (was === nowText) continue;
    if (now === null) {
      rmSync(p, { force: true });
    } else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, nowText!);
    }
  }
}

function run(argv: string[]): { code: number; out: string[] } {
  let cli: Cli;
  try {
    cli = parseCli(argv);
  } catch (e) {
    if (e instanceof ParseFault) return { code: 2, out: [e.line] };
    throw e;
  }
  let text = '';
  try {
    text = readFileSync(cli.patch ?? 0, 'utf8');
  } catch {
    if (cli.patch !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = splitPatchLines(text);
  const kind = cli.format === 'auto' ? detectFormat(lines) : cli.format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = parseJson(text, lines);
    else if (kind === 'unified') edits = parseUnified(lines).map((s) => unifiedEdit(s, cli.strict));
    else if (kind === 'search-replace') edits = parseSearchReplace(lines, cli.strict);
    else edits = parseV4a(lines, cli.strict);
    if (edits.length === 0) throw new ParseFault('error: parse 1');
  } catch (e) {
    if (e instanceof ParseFault) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new WorkTree();
  const fails: EditFault[] = [];
  for (const edit of edits) {
    const snap = tree.snapshot();
    const movesBefore = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof EditFault)) throw e;
      tree.restore(snap);
      tree.moves.length = movesBefore;
      fails.push(e);
    }
  }
  if (fails.length > 0) {
    return {
      code: 1,
      out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`],
    };
  }
  const rows = buildRows(tree);
  if (!cli.check) writeTree(tree);
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
