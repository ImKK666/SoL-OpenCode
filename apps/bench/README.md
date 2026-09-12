# Benchmark: task suite with capability + efficiency gates

An upstream-parity evaluation harness, adapted from SoL-Pi's EdgeBench
methodology and run against OpenCode.

Upstream evaluates a harness by running a **suite of verifiable tasks** in two
arms and reporting **capability and efficiency together**, admitting an
efficiency win only if the task score does not drop. This directory implements
that same shape for SoL-OpenCode.

## Two halves: dev vs held-out

The harness is split the way upstream splits training environments from
EdgeBench:

| half | set | discipline |
|---|---|---|
| **dev** — `bench.mjs`, `tasks/` | 6 synthetic verifier tasks | inspectable, free to iterate on |
| **held-out** — [`tb/`](./tb/README.md) | 63 CPU-only Terminal-Bench 4.0 tasks | frozen candidate, one-shot, report-only |

[`heldout/`](./heldout/) enforces the second half in code: a candidate is
**frozen** (plugin version + source hash + eval-set hash), a run **refuses** if
the live candidate drifted, a freeze is **one-shot**, and the dev set may not
overlap the held-out set. Results are appended to an immutable ledger and read
back — never fed into tuning.

```bash
node heldout/cli.mjs freeze --label "..."   # declare candidate + eval set
node heldout/cli.mjs status                 # frozen candidates and run counts
node heldout/cli.mjs report                 # capability + efficiency from the ledger
```

## Methodology parity

| upstream SoL-Pi | this harness |
|---|---|
| executable tasks with fail-before / pass-after verifiers | same — each task's `npm test` fails before the fix, passes after |
| keep a task only if its verifier flips | same — `generate.mjs` emits only flipping tasks |
| two arms (Pi vs SoL-Pi) | plugin **off** vs **on** |
| capability reported as solved tasks | same |
| efficiency reported as tokens and cost | same |
| a capability floor gates the efficiency win | same (`capability floor` in the report) |
| consolidated report | same shape (solved, total cost, cost per solved) |

## Task suite

`tasks/<id>/` holds a self-contained Node project:

```
tasks/<id>/
├── task.json          # { id, prompt, test: "npm test" }
└── repo/              # starting code with one bug + a node:test suite
```

Tasks are **generated** by [`generate.mjs`](./generate.mjs) (verifier-driven, no
reference trajectory — upstream's synthetic family). Current suite:

| task | bug | verifier |
|---|---|---|
| `stack-lifo` | `pop()` shifts from the front | LIFO order, 122 tests |
| `queue-fifo` | `dequeue()` pops from the back | FIFO order, 122 tests |
| `range-sum` | exclusive upper bound | inclusive sums, 181 tests |
| `slugify` | no normalization | slug equality, 66 tests |
| `parse-duration` | hours/minutes mis-scaled | unit conversion, 65 tests |
| `array-chunk` | drops the remainder | chunking, 82 tests |

Regenerate with `node apps/bench/generate.mjs`.

## Run

```bash
node apps/bench/bench.mjs                     # all tasks, 1 round, both arms
node apps/bench/bench.mjs --rounds 3          # 3 rounds
node apps/bench/bench.mjs --tasks stack-lifo  # a subset
node apps/bench/bench.mjs --list              # list tasks
```

Each task x arm x round runs in its own copy of the task repo, with an isolated
HOME seeded with only the model catalogue and credentials (see
`../e2e/real.mjs` for the same isolation rationale).

## Report

```
=== aggregate (6 tasks x N) ===
metric             | control    | treatment  | delta
solved             | 6/6        | 6/6        | 0
total tokens       | ...        | ...        | -xx%
total cost (USD)   | ...        | ...        | -xx%
cost per solved    | ...        | ...        | 
total wall (s)     | ...        | ...        | +xx%

=== gate (upstream methodology) ===
capability floor (solved >= control): PASS
efficiency (lower cost):             PASS
verdict: ADMISSIBLE
```

## Reference smoke result

`--tasks stack-lifo --rounds 1`, `opencode-go/deepseek-v4.1-flash`:

| metric | control | treatment | delta |
|---|---|---|---|
| solved | 1/1 | 1/1 | 0 |
| total tokens | 28,080 | 10,800 | **−61.5%** |
| total cost (USD) | 0.0049 | 0.0020 | **−59.1%** |

Gate: **ADMISSIBLE** (efficiency win, no capability loss).

## Fidelity limits (read before quoting)

- These are **synthetic verifier-driven tasks**, not upstream's held-out
  EdgeBench suite (51 tasks) or Terminal-Bench 4. They exercise the same
  methodology, not the same task distribution.
- A task is a short single-bug fix, so the **capability signal is weak** —
  a suite where both arms usually solve everything cannot detect a small
  capability regression the way EdgeBench does.
- Small N. Widen `--rounds` for stable medians; a single round is a smoke test.

A true like-for-like comparison would run the *same* suite with the *same* model
on both Pi + SoL-Pi and OpenCode + SoL-OpenCode.
