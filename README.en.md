# SoL-OpenCode

[简体中文](./README.md) | **English**

Standalone [OpenCode](https://opencode.ai) plugin porting SoL-Pi's context and
tool-efficiency mechanisms. Every mechanism is **opt-in** and disabled by
default.

> Status: all five mechanisms are implemented, unit-tested, and measured against
> the real **Terminal-Bench 4.0** benchmark. See [Benchmarks](#benchmarks).

## Layout

```
packages/
├── core/       @alicekk/sol-opencode-core     — harness-agnostic logic, zero dependencies
└── opencode/   @alicekk/sol-opencode — the OpenCode plugin (uses core)
apps/
├── e2e/        deterministic mock A/B + real-model A/B harness
└── bench/      dev suite, held-out discipline, Terminal-Bench 4 harness
DESIGN.md                            — the port design and phased plan
```

## Requirements

- Node.js 22.19 or newer
- [Bun](https://bun.sh) for installation (npm 10 has an arborist bug with
  vitest's peer graph)
- OpenCode with plugin support (`@opencode-ai/plugin` 1.18.30)

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

Two halves, split the way upstream splits training environments from its
held-out set:

| half | set | discipline |
|---|---|---|
| **dev** — [`apps/bench`](./apps/bench/README.md) | 6 synthetic verifier tasks | inspectable, free to iterate on |
| **held-out** — [`apps/bench/tb`](./apps/bench/tb/README.md) | 63 CPU-only Terminal-Bench 4.0 tasks | frozen candidate, one-shot, report-only |

The held-out half enforces upstream SoL-Pi's protocol in code: a candidate is
frozen (plugin version + source hash + pinned npm artifact + eval-set hash), a
run refuses if the live candidate drifted, a freeze is one-shot, and the dev and
held-out sets may not overlap. Results append to an immutable ledger.

### Mechanism correctness (deterministic, mock provider)

Same scripted conversation, plugin off vs on — no model randomness
([`apps/e2e`](./apps/e2e/README.md)):

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
receipt). **Neither arm solved the task, so this does not yet show that
capability is preserved** — it shows the mechanism works on a real benchmark
task. Cost reality: ~$0.08/task, so the full run is ~$10; wall time
(~30 min/task) is the real constraint.

### Comparison with upstream SoL-Pi

SoL-Pi (NVIDIA) reports efficiency on **Pi**. This port is compared
**directionally only** — different harness, model, and tasks:

| source | setup | headline |
|---|---|---|
| SoL-Pi (published) | vs Pi, EdgeBench | 45–49% fewer tokens, ~⅓ lower cost, ~94% of Pi's score |
| SoL-Pi (published) | Terminal-Bench 4 (63 tasks) | 15/63 solved @ $211 vs Pi 18/63 @ $286 |
| SoL-OpenCode (here) | vs plugin-off, 1 task, N=5 | tokens −50.3%, cost −43.6%, success 100% |
| SoL-OpenCode (here) | Terminal-Bench 4, 1 task, N=1 | tokens −61.3%, cost −33.9%, capability unmeasured |

The token reduction is in the same band as upstream's vs-Pi figure, but **none of
this is a like-for-like benchmark**. Upstream also reports a capability cost
(~94% of Pi's score; 15/63 vs 18/63 on Terminal-Bench 4). Treat these as
directional sanity checks, not claims of parity.

### Roadmap

- ⬜ full 63-task held-out run (capability + efficiency together, ~$10)
- ⬜ like-for-like **Pi + SoL-Pi vs OpenCode + SoL-OpenCode** on one model —
  Harbor ships a `pi` agent, so this is now reachable
- ⬜ per-mechanism ablations

## Development

```bash
bun install
bun run check       # tsc --noEmit + vitest
bun run e2e:all     # deterministic mock A/B (baseline/observation-pack/action-fusion/reducer)
bun run e2e:real 5  # real-model A/B, 5 rounds (opencode-go/deepseek-v4.1-flash)
bun run bench       # dev suite, capability + efficiency gates
```

## License

MIT.
