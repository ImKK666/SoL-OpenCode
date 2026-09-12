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

## Configure

Enable mechanisms through OpenCode's plugin options tuple:

```jsonc
// opencode.json
{
  "plugin": [
    ["@alicekk/sol-opencode", {
      "trajectoryInspector": { "enabled": true },
      "actionFusion": { "enabled": true, "tools": ["edit", "write"] },
      "observationPack": { "enabled": true, "thresholdBytes": 10240, "fullSends": 2 },
      "evidencePreservingReducer": { "enabled": false },
      "onlineContextCompact": { "enabled": false }
    }]
  ]
}
```

A missing key leaves the mechanism disabled.

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
