# Deterministic e2e: measuring the mechanisms

This harness measures the effect of SoL-OpenCode's mechanisms **deterministically**:
it runs the real OpenCode CLI against a local mock provider that records every
request payload, then compares a control run (plugin off) with a treatment run
(one mechanism on) for the *same scripted conversation*.

Because the model is scripted and local, the run is reproducible — no real API,
no model nondeterminism.

## How it works

```
ab.mjs <scenario>
  ├─ control   : opencode run …            (config without the plugin)
  └─ treatment : opencode run …            (config loads the local plugin with one mechanism enabled)
        │
        └─ mock-provider.mjs (OpenAI-compatible, in-process)
               • answers deterministically from the scenario script
               • records every /v1/chat/completions body
        └─ metrics computed from the recorded bodies
```

Per run the harness:

- starts a mock provider on a free port and writes a throwaway project with an
  `opencode.json` that defines the `mock` provider (`@ai-sdk/openai-compatible`);
- spawns `opencode run "<prompt>" -m mock/mock-1` with an **isolated HOME/XDG**
  so the developer's global config and plugins never load;
- drops `OPENCODE`/`OPENCODE_PID` from the child env and pins `OPENCODE_CONFIG`
  + `PWD` to the throwaway project, so OpenCode resolves the project correctly;
- computes metrics from the mock's recorded requests, skipping the one-off
  "title generator" request.

## Metrics

| metric | meaning |
|---|---|
| `requests` | main-loop provider requests (turns) |
| `totalPromptChars` | Σ size of the `messages` array sent, over all requests |
| `totalPromptTokens(~4)` | the same, estimated at ~4 chars/token |
| `totalToolChars` | Σ bytes of tool results replayed across requests |
| `maxRequestChars` | largest single request |

## Scenarios

| scenario | models | expected |
|---|---|---|
| `baseline` | no tools, one turn | ~0 delta (harness sanity check) |
| `observation-pack` | one ~20 KiB tool result replayed across turns | fewer replayed tool bytes |
| `action-fusion` | an `edit` carrying `then_run` | one fewer turn, fewer prompt chars |
| `reducer` | a long failing build log | log replaced by a verified receipt |

## Usage

```bash
node apps/e2e/ab.mjs baseline
node apps/e2e/ab.mjs observation-pack
node apps/e2e/ab.mjs action-fusion
node apps/e2e/ab.mjs reducer
```

Requires the `opencode` CLI on PATH (or set `OPENCODE_BIN`). Override the log
level with `E2E_LOG_LEVEL=INFO` and dump the generated config with
`E2E_DEBUG=1`.

## Reference results

Measured on OpenCode 1.18.30 (2026-09), single run each (fully deterministic):

| scenario | requests (off→on) | totalPromptChars | totalToolChars |
|---|---|---|---|
| baseline | 1 → 1 | 0.0% | 0% |
| observation-pack | 6 → 6 | **−12.1%** | **−58.7%** |
| action-fusion | 3 → 2 | **−33.5%** | −4.7% |
| reducer | 4 → 4 | **−16.9%** | **−95.1%** |

The `totalPromptChars` delta is always diluted by OpenCode's constant system
prompt (~63 KB per request); `totalToolChars` and `requests` isolate each
mechanism's direct effect.

## Adding a scenario

Add an entry to `scenarios.mjs`:

```js
"my-scenario": {
  prompt: "...",                       // user message
  model: "mock-1",
  script: {
    "…needle in the prompt…": [        // steps are chosen by tool-result count
      [{ name: "bash", args: { command: "…" } }],  // a turn that calls tools
      "final text",                                 // a turn that stops
    ],
  },
  setupFiles: { "demo.txt": "hello\n" },           // optional project fixtures
  plugin: { observationPack: { enabled: true } },  // mechanism(s) under test
}
```

A step may instead be `{ conditional: true, ifFused: …, ifNotFused: … }` to model
an agent that reacts to whether Action Fusion ran (the mock checks the tool
result for `[then_run:`).

## Not yet covered

- **Online Context Compact** scenario (needs a long horizon and a scripted
  `session.summarize`).
- Byte-exact token counting (currently `chars/4`); wire a real tokenizer if an
  exact figure is needed.
