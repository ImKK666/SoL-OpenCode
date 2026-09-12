# @alicekk/sol-opencode

An [OpenCode](https://opencode.ai) plugin porting the five efficiency mechanisms
from NVIDIA's [SoL-Pi](https://github.com/NVlabs/SoL-Pi). Every mechanism is
**opt-in** and disabled by default.

## Install

Add the plugin to `opencode.json`; OpenCode installs it automatically:

```jsonc
{
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

## Mechanisms

| Mechanism | What it does |
|---|---|
| **Trajectory Inspector** | Metadata-only JSONL of turns, tools and compactions. No prompts/args/output stored. |
| **Action Fusion** | `edit`/`write` accept an optional `then_run`; the command runs in the same call. |
| **ObservationPack** | Large tool results become `obs_<id>` handles with exact paged/literal recall. |
| **Evidence-Preserving Reducer** | Long diagnostic logs reduced to a verified receipt over a child session. |
| **Online Context Compact** | Plan-aware, economic compaction via `session.summarize`, with loop guards. |

When enabling `onlineContextCompact`, set `"compaction": { "auto": false }` in
`opencode.json` so the built-in size-based compaction does not compete.

## CLI

```bash
sol-trajectory sessions [project-slug]   # list sessions
sol-trajectory show <session-path>       # print recorded events
sol-trajectory tail <session-path>       # follow the events file
```

## Data and security

Archives and metadata are written under `$SOL_OPENCODE_HOME` (default
`~/.local/share/sol-opencode`). The reducer is disabled by default and is the
only mechanism that sends content (eligible diagnostic logs) to a model. See
`SECURITY.md` in the repository.

## License

MIT.
