# SoL-OpenCode

Standalone [OpenCode](https://opencode.ai) plugin porting SoL-Pi's context and
tool-efficiency mechanisms. Every mechanism is **opt-in** and disabled by
default.

> Status: all five mechanisms are implemented against the harness-agnostic core
> and unit-tested. They still need validation in a live OpenCode session — see
> the verification spikes in [`DESIGN.md`](./DESIGN.md) §11.

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

## Development

```bash
bun run typecheck   # tsc --noEmit
bun run test        # vitest run
bun run check       # both
```

## License

MIT.
