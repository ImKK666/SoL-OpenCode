# Security

SoL-OpenCode archives tool output locally and can send diagnostic-log content to
a model. This document describes what leaves the machine and what stays on disk.

## Local storage

ObservationPack and the Evidence-Preserving Reducer archive eligible tool output
under the session root:

```
<SOL_OPENCODE_HOME or ~/.local/share/sol-opencode>/<project-slug>/<session-id>/
├── observation-pack/{objects/, ledger.jsonl}
├── evidence-preserving-reducer/{objects/, journal.jsonl}
├── online-context-compact/state.json
└── trajectory-inspector/events.jsonl
```

- Object files are created with mode `0600` and directories with `0700`; writes
  use `O_CREAT|O_EXCL|O_NOFOLLOW`, and an existing object is verified byte for
  byte before it is reused.
- Archives are **not** deleted when a session ends. Remove the session directory
  to reclaim space.
- **Trajectory Inspector writes metadata only** — event kinds, timestamps,
  statuses, model/tool names, byte counts and correlation ids. It never stores
  prompts, assistant text, tool arguments, or tool output.

## What is sent to a model

- **Evidence-Preserving Reducer** sends eligible diagnostic-log content to the
  provider/model configured for the reducer, over a child session. That content
  leaves the machine and is subject to the provider's data handling.
  - Disabled by default.
  - A `LIKELY_SECRET` heuristic skips content that resembles credentials
    (`api_key`, `authorization`, `bearer`, `access_token`, `secret`); this is
    best-effort, not a guarantee.
  - Do not enable remote reduction for logs that must remain local.
- **ObservationPack** and **Action Fusion** make no additional model calls.
- **Online Context Compact** asks the configured provider to summarize the
  session — the same provider the main agent already uses.

## Failure behaviour

Every mechanism fails open: if reduction, archiving, recall or compaction fails,
the original tool result and the agent's run are left unchanged. Archives and
journals are local evidence, never an authority over pass/fail decisions.

## Reporting a vulnerability

Please report sensitive issues privately to the repository maintainers rather
than in a public issue.
