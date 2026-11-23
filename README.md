# makefun-mend-20261123

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/AIesse/makefun-mend-20261123/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/AIesse/makefun-mend-20261123/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend is one patch tool for every AI edit format. It reads a unified diff (even one with wrong line numbers), SEARCH/REPLACE blocks, a V4A patch, or text-editor tool calls as JSON, finds the lines the edit names even when their whitespace or indentation drifted, and changes every file the edit touches or none of them. Node 22, standard library only, deterministic. The whole behaviour is `SPEC.md` version 1.

## Run it

```sh
node main.ts fix.patch
```

## Usage

```sh
node main.ts [--format=NAME] [--check] [--strict] [PATCH]
```

- `PATCH` is the path of the patch file, relative to the working directory (the root of the tree). When it is absent or `-`, the patch is read from standard input.
- `--format=NAME` reads the patch in one format: `unified`, `search-replace`, `v4a` or `json`. `auto` (the default) detects it: `*** Begin Patch` first means V4A, a first `[` or `{` means JSON, a `<<<<<<< SEARCH` line means SEARCH/REPLACE, a `diff --git` or `--- `/`+++ ` pair means unified.
- `--check` does everything but write: the same output and exit code, no file created, changed or deleted.
- `--strict` matches lines exactly (tier 0 only).
- Options and PATCH may come in any order; `--` ends the options.

Exit codes: `2` with one `error:` line for a usage, no-patch, format or parse fault; `1` with one `error: <code> <path>` line per failed edit and a `failed: <k> of <n> edits` line, writing nothing; `0` with one line per changed path (`A`/`D`/`M`, or `R <old> -> <new>` for a move) and `ok: <n> files`.

## Matching

Old lines are found at the first of three tiers where they occur at least once: exact, trailing spaces and tabs removed, leading and trailing spaces and tabs removed. A unified hunk takes the occurrence nearest to its (possibly wrong) line number; a SEARCH/REPLACE block fails as `ambiguous` when its old lines occur more than once; a V4A chunk takes the first occurrence at or after its cursor (or after its anchor). At tier 2, new lines are re-indented from the old first line's leading whitespace to the file's. Context lines are always written as the file's own matched lines.

## Testing

The kit's practice set (100 checks, with the house reference's answers) is in `practice/practice.json`:

```sh
node check.ts practice/practice.json
```

`advtest.mjs` holds 186 further checks written against `SPEC.md` sentence by sentence — usage and parse faults, all four formats, the three tiers, CRLF and missing final line breaks, moves and renames, `--check` and `--strict`, and atomicity:

```sh
node advtest.mjs
```

Current results: practice **100 of 100 (score 1000)**, adversarial **186 of 186**.

## Files

- `main.ts` — the CLI.
- `runner.ts` — the kit's runner (kept as it is); it runs `main.ts` on one check at a time in a fresh directory.
- `check.ts` — the practice set on this machine.
- `SPEC.md` — the specification.
- `practice/practice.json` — the public practice checks.
- `advtest.mjs` — the adversarial checks above.

---

<sub>Entered on [make.fun](https://make.fun/?ref=vd1ahw88&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
