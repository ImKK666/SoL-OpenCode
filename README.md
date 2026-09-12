# SoL-OpenCode

Standalone [OpenCode](https://opencode.ai) plugin porting SoL-Pi's context and
tool-efficiency mechanisms. Every mechanism is **opt-in** and disabled by
default.

> Status: all five mechanisms are implemented, unit-tested, and measured with a
> **provisional** benchmark (see [Benchmarks](#benchmarks)). Reproducing the
> upstream EdgeBench evaluation is planned — see the
> [benchmark roadmap](#benchmark-roadmap).

## Layout

```
packages/
├── core/       @alicekk/sol-opencode-core     — harness-agnostic logic, zero dependencies
└── opencode/   @alicekk/sol-opencode — the OpenCode plugin (uses core)
DESIGN.md                            — the port design and phased plan
```

## Requirements

- Node.js 22.19 or newer
- [Bun](https://bun.sh) for installation (npm 10 has an arborist bug with
  vitest's peer graph)
- OpenCode with plugin support (`@opencode-ai/plugin` 1.18.30)

## Install

```bash
bun install
bun run check   # tsc --noEmit + vitest
```

## Install

**No `npm install` is required** — OpenCode installs npm plugins itself with Bun
at startup (cached in `~/.cache/opencode/node_modules/`).

Add the plugin to your OpenCode config — `opencode.json` in a project, or
`~/.config/opencode/opencode.json` globally — then restart OpenCode:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["@alicekk/sol-opencode", {
      "trajectoryInspector": { "enabled": true },
      "actionFusion": { "enabled": true },
      "observationPack": { "enabled": true },
      "evidencePreservingReducer": { "enabled": false },
      "onlineContextCompact": { "enabled": false }
    }]
  ]
}
```

Options are the **second element** of the `[package, options]` tuple; a missing
key leaves the mechanism disabled. A string-only entry
(`"@alicekk/sol-opencode"`) loads the plugin with everything off.

Full option reference, verification steps and the lowest-risk starting config:
[`packages/opencode/README.md`](./packages/opencode/README.md).

## Mechanisms

| Mechanism | State | Notes |
|---|---|---|
| **Trajectory Inspector** | ✅ | Metadata-only JSONL of turns, tools and compactions. No prompts/args/output stored. |
| **Action Fusion** | ✅ | `edit`/`write` accept an optional `then_run`; the command runs in the same call. |
| **ObservationPack** | ✅ | Results > `thresholdBytes` become `obs_<id>` handles with exact paged/literal recall. |
| **Evidence-Preserving Reducer** | ✅ | Long diagnostic logs reduced to a verified receipt over a child session. |
| **Online Context Compact** | ✅ | Plan-aware, economic compaction via `session.summarize` with loop guards. |

### Trajectory Inspector

Data is written to:

```
<SOL_OPENCODE_HOME or ~/.local/share/sol-opencode>/<project-slug>/<session-id>/
└── trajectory-inspector/events.jsonl
```

Two ways to inspect it:

- **`sol_trajectory` tool** — ask the running agent to dump recent records.
- **CLI** — `node packages/opencode/bin/sol-trajectory.mjs <command>`:
  - `sessions [project-slug]` — list project slugs or session directories
  - `show <session-path>` — print recorded events
  - `tail <session-path>` — follow the events file

The live TUI widget is intentionally not ported: OpenCode exposes no verified
widget-registration API (see `DESIGN.md` §5.5).

## Core (`@alicekk/sol-opencode-core`)

Harness-agnostic, `node:*`-only modules shared with the future Pi adapter:

- `compact/` — compaction economics and plan transitions (pure)
- `observation-pack/` — content-addressed archive, placeholders, paged/literal recall
- `reducer/` — receipt validation with byte-for-byte quote checks, archive, LRU cache, policy gates
- `trajectory/` — bounded record store and batched JSONL writer
- `action-fusion/` — per-canonical-path queue and path resolution

## Benchmarks

> **Provisional.** These are quick, self-contained measurements to check that the
> mechanisms work and that the direction matches upstream. They are **not** the
> EdgeBench / Terminal-Bench-style evaluation SoL-Pi reports. Reproducing that
> (same suite, same model, both harnesses) is planned — see the
> [benchmark roadmap](#benchmark-roadmap).

All numbers come from [`apps/e2e`](./apps/e2e/README.md) and are reproducible.

### Mechanism correctness (deterministic, mock provider)

Same scripted conversation, plugin off vs on — no model randomness:

| scenario | requests | prompt chars | tool chars |
|---|---|---|---|
| observation-pack | 6 → 6 | −12.1% | −58.7% |
| action-fusion | 3 → 2 | −33.5% | −4.7% |
| reducer | 4 → 4 | −16.9% | −95.1% |

### Real-model effect (`opencode-go/deepseek-v4.1-flash`, median of 5)

One task — "run `npm test`, fix the bug so all 123 tests pass" — every run on a
fresh copy of the same baseline:

| metric | plugin off | plugin on | delta |
|---|---|---|---|
| success rate | 1.0 | 1.0 | — |
| total tokens | 26,617 | 13,228 | **−50.3%** |
| cost (USD) | 0.0044 | 0.0025 | **−43.6%** |
| wall time | 10.4 s | 24.5 s | +136% |

Both arms fix the bug. Tokens and cost roughly halve; wall time rises because the
reducer adds a child-session model call — a real trade-off, not a free win.

### Comparison with upstream SoL-Pi

SoL-Pi (NVIDIA) reports efficiency on **Pi**. This port is compared
**directionally only** — different harness, model, and tasks:

| source | setup | headline |
|---|---|---|
| SoL-Pi (published) | vs Pi, EdgeBench | 45–49% fewer tokens, ~⅓ lower cost, ~94% of Pi's score |
| SoL-Pi (published) | Terminal-Bench 4 (63 tasks) | 15/63 solved @ $211 vs Pi 18/63 @ $286 |
| SoL-OpenCode (here) | vs plugin-off, 1 task, N=5 | tokens −50.3%, cost −43.6%, success 100% |

The token reduction is in the same band as upstream's vs-Pi figure, but **this is
not a like-for-like benchmark**. Upstream also reports a capability cost
(~94% of Pi's score; 15/63 vs 18/63 on Terminal-Bench 4) that a single small
bug-fix task cannot measure. Treat this as a directional sanity check, not a
claim of parity.

### Benchmark roadmap

1. ✅ self-contained harness + provisional numbers (this section)
2. ⬜ rerun the **upstream EdgeBench suite** (target: the EdgeBench/87 evaluation
   SoL-Pi reports) with the same model on both arms — Pi + SoL-Pi and
   OpenCode + SoL-OpenCode — the only like-for-like comparison
3. ⬜ report **capability alongside cost** (task score, not only tokens)
4. ⬜ widen N and add per-mechanism ablations

Progress since (see [`apps/bench`](./apps/bench/README.md)):

- ✅ **verifier-driven dev suite** with capability + efficiency gates
  (`apps/bench`)
- ✅ **held-out discipline** — frozen candidate, drift guard, one-shot
  ledger, dev/held-out disjointness (`apps/bench/heldout`)
- ✅ **Terminal-Bench 4.0 wired** via Harbor on the **63 CPU-only tasks**
  (`apps/bench/tb`) — the same suite upstream reports
- ✅ **paired probe on a real TB4 task** — tokens −61.3%, cost −33.9% (below)
- ⬜ full 63-task held-out run; like-for-like **Pi + SoL-Pi vs
  OpenCode + SoL-OpenCode** (Harbor ships a `pi` agent, so this is reachable)

### Terminal-Bench 4 paired probe (real benchmark, N=1)

TB 4.0, `html-js-filter`, `opencode-go/deepseek-v4.1-flash`, one arm each — the
first measurement on the actual benchmark upstream uses:

| | control | treatment | delta |
|---|---|---|---|
| reward | 0.0 | 0.0 | — |
| input tokens | 11,402,619 | 4,410,582 | **−61.3%** |
| cost (USD) | 0.1249 | 0.0826 | **−33.9%** |
| wall | 34m55s | 28m17s | −19.0% |
| exceptions | 0 | 0 | — |

The two arms genuinely differ (the control container logs contain **zero**
`sol-opencode` references; the treatment logs contain eight, including a reducer
receipt). Neither arm solved the task, so this shows the mechanism works on a
real benchmark task — it does **not** yet show capability is preserved. Cost
reality: ~$0.08/task, so the full run is ~$10; wall time (~30 min/task) is the
real constraint. See [`apps/bench/tb/README.md`](./apps/bench/tb/README.md).

## Development

```bash
bun run typecheck   # tsc --noEmit
bun run test        # vitest run
bun run check       # both
bun run e2e:all     # deterministic mock A/B (baseline/observation-pack/action-fusion/reducer)
bun run e2e:real 5  # real-model A/B, 5 rounds (opencode-go/deepseek-v4.1-flash)
```

## License

MIT.
