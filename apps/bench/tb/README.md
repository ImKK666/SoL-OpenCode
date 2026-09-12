# Terminal-Bench 4.0 (held-out evaluation)

The held-out half of the benchmark. Where [`../`](../README.md) is a cheap,
inspectable dev suite, this runs the **real external benchmark** upstream
SoL-Pi reports on, under the [held-out discipline](../heldout/).

## Why Harbor, not `tb`

Terminal-Bench 4.0 is **not** runnable with the Laude `terminal-bench` pip
package. That package is frozen at `terminal-bench-core` v0.1.x; its own README
redirects new users to **Harbor**. TB 4.0 lives on the Harbor framework:

```
harbor run -d terminal-bench/terminal-bench@4.0.0
```

Installed here as `harbor` (v0.23.0) in a contained venv.

## The 63-task CPU-only set

TB 4.0 is 66 tasks. Exactly **three** declare `gpus = 1`:

| excluded task | why |
|---|---|
| `jax-speedrun-gpu` | `gpus = 1`, H100 |
| `fp8-rmsnorm-gemm` | `gpus = 1`, H100 |
| `math-eval-grader` | `gpus = 1` |

The other 63 are CPU-only — the same subset size upstream reports. This was
verified per-task from each `task.toml` on the `v4.0.0` tag, not inferred from
names: `sglang-qwen-burst` and `vllm-deepseek-streaming` *sound* GPU but declare
`gpus = 0` and are included.

The set is pinned in [`../heldout/split.json`](../heldout/split.json).

## Two arms

Harbor's built-in `opencode` agent accepts an **`opencode_config`** overlay that
is deep-merged into `~/.config/opencode/opencode.json` inside the task
container. That is the *only* difference between arms:

| arm | overlay |
|---|---|
| `control` | provider block only (vanilla opencode) |
| `treatment` | provider block + `plugin: [[<pinned spec>, <all mechanisms on>]]` |

The plugin spec is **pinned to the frozen candidate** (`@alicekk/sol-opencode@0.1.0`),
not floated to "whatever is on npm today" — the ledger names the exact artifact
that ran. The frozen manifest also records a `sourceHash` of the local
plugin/core trees, so editing the mechanisms after a freeze invalidates it.

The provider block comes from the local model catalogue: `opencode-go` is an
OpenAI-compatible endpoint (`npm: @ai-sdk/openai-compatible`,
`api: https://opencode.ai/zen/go/v1`). The API key is read from
`~/.local/share/opencode/auth.json` and passed as `OPENCODE_API_KEY` — never
logged, never through a shell.

## Measurement

Harbor's opencode agent already parses `opencode run --format=json` and sums the
`step_finish` events, so we read its numbers back instead of re-deriving them:

- **capability** — `verifier_result.rewards.reward` (1.0 solved)
- **efficiency** — `agent_result.n_input_tokens + n_output_tokens`, `cost_usd`

## Run

```bash
# 1. freeze the candidate + eval set (writes an immutable manifest)
node ../heldout/cli.mjs freeze --label "tb4.0-cpu63"

# 2. one arm, once (the guards consume the one-shot)
node harbor.mjs --freeze <id> --arm treatment -n 4
node harbor.mjs --freeze <id> --arm control   -n 4

# 3. report from the ledger
node ../heldout/cli.mjs report --freeze-id <id>

# 4. check a freeze is still valid, without consuming the one-shot
node ../heldout/cli.mjs verify --freeze-id <id>
```

`--only a,b,c` narrows the task list for **plumbing** work; it is stamped
`datasetSubset: true` in the ledger so a subset result can never be mistaken for
a full held-out result.

## Cost and time — measured, not assumed

Upstream reports **$211–$286 for all 63 tasks** — but that is a frontier model at
`xhigh`. On the model used here the price is ~40× lower. A real probe (1 task,
treatment arm, 2026-09-12):

| | measured |
|---|---|
| wall time | **28 min** |
| input tokens | 4,410,582 (4,292,864 cached) |
| output tokens | 20,200 |
| **cost** | **$0.0826** |

So the full held-out evaluation is ~$10, not ~$450 — the binding constraint is
**wall time, not money**:

| scope | approx cost | approx wall (n-concurrent 4) |
|---|---|---|
| 1 task, 1 arm | $0.08 | ~28 min |
| 10 tasks × 2 arms | ~$1.6 | ~2.5 h |
| 63 tasks × 2 arms | ~$10 | ~15 h |

The 4.4M input tokens for one task is itself a finding: context churn is high,
which is exactly what the mechanisms target.

## Status

| piece | state |
|---|---|
| Harbor + TB 4.0 resolution | ✅ verified (`--dry-run`, 66 trials) |
| 63-task CPU-only set | ✅ verified per-task |
| plugin overlay accepted by Harbor | ✅ verified (`--dry-run`) |
| runner + guards | ✅ implements the discipline; refuses unknown/unfrozen runs |
| overlay + result parsing | ✅ unit-tested against the real Harbor 0.23.0 schema (`tb.test.mjs`) |
| end-to-end pipeline | ✅ validated with a free `nop` agent (image pull, verifier, result parsing) |
| **model path** (`opencode-go` auth inside the container) | ✅ **validated** — probe ran with 0 exceptions, billed tokens, and plugin evidence in the transcript |
| plugin actually loads in-container | ✅ reducer receipt + `sol-opencode@0.1.0` in the container logs |

## Probe result (2026-09-12, `html-js-filter`, both arms, N=1)

A paired infrastructure probe — same task, same model, one arm each:

| | control | treatment | delta |
|---|---|---|---|
| reward | 0.0 | 0.0 | — |
| input tokens | 11,402,619 | 4,410,582 | **−61.3%** |
| output tokens | 33,080 | 20,200 | −38.9% |
| cost (USD) | 0.1249 | 0.0826 | **−33.9%** |
| wall | 34 min 55 s | 28 min 17 s | −19.0% |
| exceptions | 0 | 0 | — |

What this establishes:

- **auth works** — both arms billed tokens with zero exceptions;
- **the arms genuinely differ** — the treatment container logs contain 8
  `sol-opencode` references (including an `evidence-preserving-reducer` receipt
  with `reducer_total_tokens=12646`); the control logs contain **zero**;
- **the plugin did not break the task** — both arms scored 0.0, so the earlier
  reward-0 was task difficulty, not a regression;
- **the token reduction replicates** — −61% tokens / −34% cost on a *real* TB4
  task, consistent with the dev suite and with upstream.

Caveats: N=1, and neither arm solved the task, so this says nothing about
capability — only that the mechanism works and the plumbing is sound.

## Known gaps

1. **Capability is unmeasured so far.** Both probe arms scored 0 on the one task
   tried, so the probe shows the mechanism works but says nothing about whether
   it preserves task score. That is what the full held-out run is for.
2. **Like-for-like is now within reach.** Harbor also ships a **`pi`** agent
   (`thinking` level `xhigh`, as upstream used). Running the same 63 tasks with
   Pi+SoL-Pi and OpenCode+SoL-OpenCode on one model is the true comparison.
