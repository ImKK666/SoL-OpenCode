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

## Real-model A/B (`real.mjs`)

The mock harness proves each mechanism works in isolation. `real.mjs` validates
the effect under a **real model** on a real task.

- baseline fixture: `fixtures/benchmark-app` — a small project with a bug and 123
  tests (120 failing); `npm test` emits ~112 KB. The baseline is **never mutated**.
- every run copies the baseline into its own directory, so runs cannot affect each
  other and all start from identical code
- same task + model for control (plugin off) and treatment (all mechanisms on)
- each run's token/cost is parsed from `opencode run --format json`
- N rounds; compared by median

```bash
node apps/e2e/real.mjs 3 [--model provider/model]
```

Real providers need credentials and the model catalogue, so each run gets an
isolated HOME seeded with only `~/.cache/opencode/models.json` and
`~/.local/share/opencode/auth.json`; the developer's global config never loads.

### Reference result (N=5, `opencode-go/deepseek-v4.1-flash`)

Task: "Run `npm test`, fix the bug in `src/stack.js`, verify." Median of 5.

| metric | control | treatment | delta |
|---|---|---|---|
| success rate | 1.0 | 1.0 | — |
| steps | 4 | 5 | +1 |
| input tokens | 26,159 | 12,597 | **−51.8%** |
| cacheRead | 59,904 | 37,248 | **−37.8%** |
| output tokens | 458 | 421 | −8.1% |
| total tokens | 26,617 | 13,228 | **−50.3%** |
| cost (USD) | 0.0044 | 0.0025 | **−43.6%** |
| wall time | 10.4 s | 24.5 s | **+136%** |

Both modes fixed the bug. **Tokens and cost roughly halve; wall time rises**
because the reducer adds a child-session model call — a real trade-off to weigh.
Per-round variance is high (control `cacheRead` ranged 59.9k–86.5k); widen the
rounds for tighter medians.

## Comparison with upstream SoL-Pi's published results

SoL-Pi (NVIDIA) reports harness-level efficiency on **Pi**. This port can only be
compared **directionally**: different harness (Pi → OpenCode), different model
(frontier models at `xhigh` → `opencode-go/deepseek-v4.1-flash`), different tasks
(EdgeBench / Terminal-Bench 4 → the one fixture task here).

| source | setup | headline effect |
|---|---|---|
| SoL-Pi (published) | vs Pi, EdgeBench | 45–49% fewer tokens, ~⅓ lower cost, ~94% of Pi's score |
| SoL-Pi (published) | ObservationPack, paired EdgeBench | provider bill −23.58%, score +22.92% |
| SoL-Pi (published) | Action Fusion, trajectory counterfactual | model turns −10.8%, tokens −11.5% |
| SoL-Pi (published) | Terminal-Bench 4 (63 tasks) | 15/63 solved @ $211 vs Pi 18/63 @ $286 |
| **SoL-OpenCode (this repo)** | vs plugin-off, fixture task, N=5 | **tokens −50.3%, cost −43.6%, success 100%** |

The token-reduction magnitude lands in the same band as upstream's vs-Pi figure,
and our cost reduction is somewhat larger — but the setups are not identical, so
treat this as a **directional sanity check, not a like-for-like benchmark**.

Two differences worth stating plainly:

- **Capability cost.** Upstream keeps ~94% of Pi's score (and, on Terminal-Bench 4,
  solves 15/63 vs Pi's 18/63). Our fixture is a single small bug fix that both arms
  solve, so it carries **no capability signal**. A real capability check needs a
  task suite like EdgeBench/Terminal-Bench.
- **Like-for-like** would run the *same* task suite on Pi+SoL-Pi and
  OpenCode+SoL-OpenCode with the *same* model. This harness is the OpenCode half of
  that; it is not a substitute for the upstream evaluation.

## Not yet covered

- **Online Context Compact** scenario (needs a long horizon and a scripted
  `session.summarize`).
- Byte-exact token counting (currently `chars/4`); wire a real tokenizer if an
  exact figure is needed.
