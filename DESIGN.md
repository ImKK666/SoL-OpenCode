# SoL-OpenCode — Design

> **Status:** Draft for review · **Scope:** design specification only (no implementation)
> **Source of truth:** architecture blueprint derived from a read-only review of SoL-Pi's portable cores (`/Users/kk/project/Sol-Pi`) plus a source-level verification of the OpenCode plugin API (`sst/opencode`).
> **Purpose:** define the repository, module boundaries, and per-mechanism behavior for porting SoL-Pi's five efficiency mechanisms from the Pi harness to an OpenCode plugin.

---

## 1. Overview

### 1.1 Goal

Build a standalone OpenCode plugin that ports the five token-efficiency mechanisms that survived SoL-Pi's auto-research loop, preserving their core guarantees:

- **No harness patches.** Use only OpenCode's public plugin API.
- **Explicit opt-in.** A missing configuration leaves every mechanism disabled.
- **Preserve evidence.** Original observations stay readable; every reduction fails open.
- **Harness owns runtime choices.** Auth, provider URLs, model selection, and shell behavior remain OpenCode's.

### 1.2 Non-goals

- Modifying OpenCode core or SoL-Pi.
- Replacing OpenCode's built-in tools, truncation, or compaction.
- Any mechanism that early-stops a task, skips verification, or hides evidence.

### 1.3 The five mechanisms

| Mechanism | What it does |
|---|---|
| **Action Fusion** | An `edit`/`write` call may carry `then_run: {command, timeout?}`; the mutation and its follow-up validation run in one call, returning a single combined result. |
| **ObservationPack** | Large tool results are archived content-addressed and, after a short full-send grace period, replaced in the projected context by a stable `obs_<24hex>` handle with exact paged/literal recall. |
| **Evidence-Preserving Reducer** | Long diagnostic logs are reduced to a receipt **only** when every retained quotation matches the archived source byte-for-byte and the source hash/status match; otherwise the original passes through unchanged. |
| **Online Context Compact** | Newly completed plan steps become candidate points for economic, window-pressure-checked compaction; after a successful compaction the task continues in a new turn with a plan reminder. |
| **Trajectory Inspector** | A metadata-only JSONL view of recent turns, requests, tools, results, and compactions (never prompts, args, or output). |

### 1.4 Bottom line

Build `SoL-OpenCode` as a **Bun-workspaces monorepo**: a harness-agnostic `@alicekk/sol-opencode-core` package (zero dependencies, `node:*` only) extracted from SoL-Pi's portable files, an `@alicekk/sol-opencode` plugin package wiring the core onto the verified hook set, and a future `packages/pi` adapter so SoL-Pi itself can consume the same core.

Every mechanism maps onto **verified** hooks without inventing API:

- **Action Fusion** → `tool.definition` + `tool.execute.before`/`after`, command execution via `input.$`.
- **ObservationPack** → `experimental.chat.messages.transform` + a registered `obs_recall` tool + `metadata.outputPath` archives.
- **Reducer** → `tool.execute.after` replacement + a child-session auxiliary-model transport.
- **Online Context Compact** → `todo.updated` + `session.idle` + `client.session.summarize` + `experimental.compaction.autocontinue`.
- **Trajectory** → the `event` hook, with the TUI widget replaced by JSONL + a diagnostic tool + a tail CLI.

**Effort:** large overall (multi-week); each phase is Medium. **Confidence:** medium — hook names and behaviors are verified, but ~6 payload shapes need day-one spikes (see §11); the core-extraction design itself is high confidence.

---

## 2. Verified OpenCode plugin API facts

These facts are the foundation of the design. Nothing outside this list may be assumed.

### 2.1 Plugin model

- A plugin is `async (input: PluginInput) => Hooks`.
- `PluginInput = { client (SDK), project, directory, worktree, serverUrl, $ (Bun shell), experimental_workspace }`.
- Hook callbacks receive `(input, output)` and **mutate `output` in place**; hooks chain **sequentially** across plugins.

### 2.2 Hook inventory

| Hook | `input` | `output` (mutable) |
|---|---|---|
| `event` | `{ event }` | — |
| `config` | `Config` | — |
| `tool` | — | `{ [name]: ToolDefinition }` (registration) |
| `auth` / `provider` | — | provider/auth hooks |
| `chat.message` | `{ sessionID, agent?, model?, messageID?, variant? }` | `{ message, parts }` |
| `chat.params` | `{ sessionID, agent, model, provider, message }` | `{ temperature, topP, topK, maxOutputTokens, options }` |
| `chat.headers` | `{ sessionID, agent, model, provider, message }` | `{ headers }` |
| `permission.ask` | `Permission` | `{ status }` — **declared but not invoked in current core** |
| `command.execute.before` | `{ command, sessionID, arguments }` | `{ parts }` |
| `tool.execute.before` | `{ tool, sessionID, callID }` | `{ args }` |
| `tool.execute.after` | `{ tool, sessionID, callID, args }` | `{ title, output: string, metadata: any }` |
| `tool.definition` | `{ toolID }` | `{ description, parameters }` |
| `shell.env` | `{ cwd, sessionID?, callID? }` | `{ env }` |
| `experimental.chat.messages.transform` | `{}` | `{ messages: { info, parts }[] }` |
| `experimental.chat.system.transform` | `{ sessionID?, model }` | `{ system: string[] }` |
| `experimental.session.compacting` | `{ sessionID }` | `{ context: string[], prompt? }` |
| `experimental.compaction.autocontinue` | `{ sessionID, agent, model, provider, message, overflow }` | `{ enabled }` |
| `experimental.text.complete` | `{ sessionID, messageID, partID }` | `{ text }` |
| `experimental.provider.small_model` | `{ provider }` | `{ model? }` |

### 2.3 Verified behaviors (load-bearing)

1. **Tool-output truncation happens before the plugin sees it.** Built-in tools apply `MAX_LINES = 2000` / `MAX_BYTES = 50 KiB` (configurable via `tool_output.max_lines` / `tool_output.max_bytes`) **inside** the tool wrapper, *before* `tool.execute.after`. The full text is written to disk and surfaced at `metadata.outputPath`; the message part stores the truncated version. Therefore `tool.execute.after` sees truncated output **plus** `outputPath`.
2. **`tool.definition` fires for ALL tools**, including built-in `edit`/`write`/`shell`. `description` and `parameters` are mutable.
3. **Arg reference semantics.** `tool.execute.before`'s `args` is the *same object reference* that `execute()` receives — in-place mutation propagates; whole-object reassignment does not. `tool.execute.after` receives that same (mutated) reference.
4. **No raw completion API.** Auxiliary model calls must go through a child session (`session.create` + `session.prompt`) or a direct provider call using credentials from the `auth`/`provider` hooks. `client.session.summarize({ sessionID, providerID, modelID, auto })` triggers compaction. `experimental.compaction.autocontinue` plus `session.idle`/`prompt_async` can continue after it.
5. **Bus events** include `message.updated`, `message.part.updated`, `session.idle`, `session.compacted`, `session.error`, `session.status`, `tool.execute.before`/`after`, `todo.updated`.

### 2.4 Prior art and known trade-offs

- OpenCode plugins **DCP** (dynamic-context-pruning) and **ACP** already do model-driven tool-result pruning via `experimental.chat.messages.transform`; they recommend **disabling `compaction.auto`** while managing context themselves.
- Message transforms reduce prompt-cache hit rate (~90% → ~85%).
- Built-in compaction is size-based (defaults `buffer = 20000`, `keep = 8000`) and truncates tool output to 2000 chars in its summaries.

**OpenCode is schema territory per adapter:** Pi uses typebox, OpenCode uses zod. Therefore `sol-core` is **schema-less**: it consumes plain data (`{toolName, toolCallId, text, isError}`) and each adapter translates.

---

## 3. Repository layout and core sharing

```
SoL-OpenCode/
├── package.json                  # Bun workspaces, vitest, tsc --noEmit
├── packages/
│   ├── core/                     # @alicekk/sol-opencode-core — harness-agnostic, ZERO deps
│   │   └── src/
│   │       ├── action-fusion/    # file-queue.ts, then-run core, markers
│   │       ├── observation-pack/ # observation.ts, ledger.ts (neutralized types)
│   │       ├── reducer/          # receipt.ts, archive.ts, cache.ts, policy.ts
│   │       ├── compact/          # economics.ts, plan.ts (already pure)
│   │       ├── trajectory/       # TrajectoryStore, record schema, jsonl.ts
│   │       └── config.ts         # shared schema constants, strict loader
│   ├── opencode/                 # @alicekk/sol-opencode — the plugin
│   │   └── src/
│   │       ├── index.ts          # export const SolOpenCodePlugin: Plugin
│   │       ├── kernel.ts         # shared adapter services (see §4)
│   │       └── mechanisms/       # one file per mechanism (see §5)
│   └── pi/                       # FUTURE: @alicekk/sol-pi-core adapter
├── apps/e2e/                     # headless SDK harness + mock provider (§8)
└── scripts/                      # core-parity check vs SoL-Pi, bench runner
```

### 3.1 Dependency direction (enforced in CI)

- `core` imports nothing but `node:*`.
- `opencode` imports `core` + `@opencode-ai/plugin` (types only).
- `pi` imports `core` + Pi peer deps.
- Adapters never import each other; core never imports an adapter.

An import-boundary lint job enforces this.

### 3.2 Extraction list from SoL-Pi (type neutralization)

- **`file-queue.ts` moves as-is** (already pure Node).
- **`then-run.ts` splits:** `assertUnchangedBeforeCommand`, markers, `ThenRunInput`, and a new `runThenRun({ absolutePath, thenRun, runCommand })` (command runner injected) go to core; `executeMutationThenRun`'s Pi orchestration stays in the Pi adapter.
- **`observation.ts` / `ledger.ts`:** `createObservation` takes a neutral `{ toolName, toolCallId, text }` instead of Pi's `ToolResultMessage`; `isPureTextResult` (a Pi type) stays in adapters. `ensureStored`, `placeholderFor`, `searchObservation`, `readRecallChunk` move unchanged.
- **Reducer:** `archive.ts` moves unchanged (it depends only on `reducer/config.ts`, which also moves). `receipt.ts` and `cache.ts` move with one adjustment: both currently import the type `ProviderResult` from the adapter-side `provider.ts`, so a neutral `ReducerModelResult` type must be extracted into core (the concrete `ProviderResult` stays adapter-side). The *policy* (`DIAGNOSTIC_COMMAND`, `minBytes`/`maxChars`/`LIKELY_SECRET` gates, cache-key construction, journal event schema) moves to `reducer/policy.ts`; `candidate.ts`'s Pi-event parsing and `provider.ts` stay adapter-side.
- **`economics.ts` and `plan.ts` move byte-for-byte** (zero imports today).
- **`trajectory.ts`:** `TrajectoryStore` + record types + the async JSONL writer move. `renderTrajectoryLines` imports `Theme` (type) plus the runtime helpers `stripTerminalSequences` and `truncateToWidth` from `pi-tui`; core ships a **plain formatter with no `pi-tui` dependency** (the two helpers are small and are reimplemented/inlined in core), and the Pi adapter re-wraps with theme colors.

### 3.3 Sharing with SoL-Pi without forking

- **Primary:** publish `@alicekk/sol-opencode-core` to npm; SoL-Pi adds it as a pinned dependency (`^1.x`) in its next minor release and its extension files shrink to Pi glue, preserving its public re-exports so downstream Pi users see no change.
- **Drift prevention:** a CI job in SoL-OpenCode (`scripts/core-parity.mjs`) installs SoL-Pi@HEAD from GitHub against the local core via a `file:` link, asserts its pinned range is supported, and runs SoL-Pi's vitest suite. Breaking core changes require coordinated releases the same week (semver + this job is the enforcement).
- **Fallback:** if the team rejects the npm publish workflow, vendor the core with a checksum-verified sync script. **Pick one; do not live with both.**

### 3.4 Packaging

- Ship **uncompiled TS** (`files: ["src"]`, `main: "src/index.ts"`), matching both SoL-Pi (`package.json` ships `src/sol-pi`) and the OpenCode plugin ecosystem convention.
- `tsc --noEmit` in CI; no bundler.
- Users install via `"plugin": ["@alicekk/sol-opencode"]` in `opencode.json`.
- Core keeps `engines: node >= 22` parity. Only the OpenCode package may touch Bun-provided APIs (`$`), and only through the injected `input.$`.

---

## 4. Adapter kernel (shared services)

One plugin entry wires all five mechanisms. Each mechanism is `(kernel) => void` and registers its hooks internally, so our own hook order is deterministic (hooks chain sequentially across plugins; internal fan-out avoids inter-mechanism ordering surprises).

```ts
interface Kernel {
  readonly input: PluginInput;              // client, $, directory, project, worktree
  readonly config: SolConfig;               // parsed + strict-validated
  sessionRoot(sessionID: string): string;   // storage root (below)
  onRequestTick(sessionID: string, messages: Msg[]): void;  // OCC observer
  isAuxSession(sessionID: string): boolean; // reducer child sessions / compaction
  markAuxSession(sessionID: string): void;
}
```

### 4.1 Storage layout

Mirrors SoL-Pi's `runtimeRoot` shape:

```
<SOL_OPENCODE_HOME or ~/.local/share/sol-opencode>/<project-slug>/<session-id>/
├── observation-pack/{objects/obs_<24hex>.txt, ledger.jsonl}
├── evidence-preserving-reducer/{objects/<sha256>, journal.jsonl}
├── online-context-compact/state.json
└── trajectory-inspector/events.jsonl
```

`project-slug` = sanitized `input.directory` + 8-hex hash. **Recommended:** an XDG-style user data dir over project-local `.sol/`, to avoid polluting the worktree (SoL-Pi used the Pi session dir; OpenCode gives no verified session-dir API, so we own the root).

Objects keep SoL-Pi's hardening: `O_CREAT|O_EXCL|O_NOFOLLOW`, mode `0600`, dirs `0700`, and `EEXIST → byte-verify`.

### 4.2 Config surface (strict-validated)

| Key | Default |
|---|---|
| `actionFusion` | `{ enabled, tools: ["edit","write"] }` |
| `observationPack` | `{ enabled, thresholdBytes: 10240, fullSends: 2 }` (+ `packRecallResults: false`) |
| `evidencePreservingReducer` | `{ enabled: false, transport: "child-session", provider, model, timeoutMs, minBytes, maxChars }` |
| `onlineContextCompact` | `{ enabled: false, cacheWriteReadRatio: 12.5, keepRecentTokens: 20000, maxAutoContinuations: 3 }` |
| `trajectoryInspector` | `{ enabled: false, maxRecords: 12 }` |

All mechanisms default **off**.

---

## 5. Per-mechanism designs

### 5.1 Action Fusion

| Concern | Design |
|---|---|
| **Schema injection** | `tool.definition` for `edit`/`write` (config-listed set): add `then_run: z.object({ command: z.string(), timeout: z.number().optional() }).optional()` to the zod raw shape **in place**; append the fusion sentence to `description`. |
| **Capture** | `tool.execute.before`: if `args.then_run` exists, stash `{ callID → { thenRun, absolutePath } }` (resolve the file-path arg to canonical form via core `resolveToolPath`) and `delete args.then_run` in place — verified to propagate to `execute()` and to the after hook's `args`. |
| **Execution** | `tool.execute.after` (same `callID`): core `runThenRun` → `assertUnchangedBeforeCommand(absolutePath)` (double sha256 with event-loop yield) → run the command via `input.$` with `timeout` enforced through `AbortSignal.timeout` (**SPIKE:** confirm Bun shell timeout/kill semantics; kill the process group on timeout). |
| **Result merge** | Mutate `output` in place: append `\n[then_run:succeeded]\n<cmd output>` / `[then_run:failed] <error>` / `[then_run:skipped] <reason>`. **Never** mark the whole call errored — the mutation stands. |
| **Failure detection** | If the mutation itself failed, skip the command. **SPIKE (day one):** determine the reliable failure signal in the after hook — candidates: a status/error key in `metadata`, the part's error flag via `message.part.updated` correlated by `callID`, or output conventions. Fallback if none exists: always run and label honestly (documented deviation). |
| **Serialization** | Keep core `withFusedFileQueue` around **hash-check + command only** (the built-in owns the mutation). A same-file edit landing between mutation and hash-check → hash mismatch → conservative `[then_run:skipped]`, exactly the designed guard. |
| **Degradation** | Any error in the after-hook path: append `[then_run:skipped] <reason>` and return; the edit result is never lost. Stash entries GC'd on after-hook consumption. |

**Proves:** `tool.definition`/before/after wiring works end-to-end; immediate, measurable turn-count reduction.

### 5.2 ObservationPack

| Concern | Design |
|---|---|
| **The 50 KiB pre-truncation** | The part text the transform sees is already ≤ 50 KiB / 2000 lines; the full bytes are on disk at `metadata.outputPath`. **Archive source:** `metadata.outputPath` when present (read, hash-verify), else the part text. The archive is therefore a **superset** of what the model ever saw; `obs_recall` pages the archive, giving access to bytes the harness truncation hid (strict improvement over stock OpenCode). |
| **Threshold** | Keep **10 KiB** (`THRESHOLD_BYTES`) applied to the *archived full text*, not the visible part. 10–50 KiB results replay at 2.5–12.5k tokens/request — exactly the waste this mechanism exists to kill. **Do not** raise the threshold to 50 KiB. **Do not** raise `tool_output.max_bytes` either. |
| **Projection** | `experimental.chat.messages.transform`: walk `messages` (skip aux sessions via kernel). For each tool-result part (**SPIKE:** exact part type/field names), reconstruct text, run core `createObservation` → `ensureStored` → decide full-send vs placeholder. |
| **Send counting (stateless, resume-safe)** | Reuse Pi's algorithm verbatim: prior sends for a part = count of assistant-role messages after it in the transformed list; request index = total assistant messages + 1. `FULL_SENDS = 2`. No in-memory state; branch/resume correct by construction. **SPIKE:** confirm `info.role` semantics and that the transform fires once per provider request. |
| **Placeholder** | Core `placeholderFor`, **deterministic bytes** (no timestamps — cache-stable). Extend the header with both `context_bytes` (size of the part being replaced) and `archive_bytes`; head/tail excerpts computed from the archived full text (the tail is where diagnostic value lives). |
| **Recall** | Register `obs_recall` via the `tool` hook (zod: `{ id, offset?, query? }`), reusing core `readRecallChunk`/`searchObservation` with the same 16 KiB / 400-line caps, 20-match search cap, 256-byte query limit, and `^obs_[a-f0-9]{24}$` id check (path-traversal safe). Ledger every recall/search. |
| **Compaction interaction** | Built-in compaction truncates tool output to 2000 chars in summaries; a ~1 KiB placeholder fits inside that, and its `id:` line survives → recall keeps working post-compaction. **Synergy, not conflict.** |
| **Degradation** | Fail-open per part: any error → log once, leave the part untouched. |

**Open sub-question (§10):** whether `obs_recall` results (≤16 KiB, above threshold) are exempt from packing. Default is parity (no exemption).

### 5.3 Evidence-Preserving Reducer

| Concern | Design |
|---|---|
| **Candidate + replace** | `tool.execute.after`: if `tool` is the shell tool and `args.command` matches `DIAGNOSTIC_COMMAND`, or if it is a fused edit/write whose output contains a then-run marker (string-slice analog of Pi's content-block scan): body = `metadata.outputPath` full text else `output`; apply core policy gates (`minBytes`, `maxChars`, `LIKELY_SECRET`); archive via core `archiveBody`; on success mutate `output` in place to `receiptText` and stamp `metadata.evidencePreservingReducer`. Receipts land below threshold → never packed (plus keep the `containsReducerReceipt` exemption as defense). |
| **Auxiliary model: strategy** | **Child session (default):** `client.session.create` → mark aux via kernel → `client.session.prompt` with `reducerInput(...)`. The plugin's `experimental.chat.system.transform` detects the tracked child sessionID and replaces the system prompt with `reducerInstructions()`, recovering most token overhead; `chat.params` pins generation params. Validation is the safety net: a child that wanders or calls tools simply fails `validateReceipt` → fallback → original output. **Advantages:** zero plugin-side secret handling (parity with "auth remains with the harness"); only verified APIs. **Costs:** tool schemas still sent (~1–2k tokens), server round-trip latency (~0.5s), child sessions visible in the session list (**SPIKE:** `client.session.delete`/cleanup; if absent, title them `sol-reducer-*` and document). |
| **Model routing** | Preferred: register a dedicated reducer provider via the `provider` hook (e.g., an alias of the user's provider pinned to the small model) and route the child to it; else `chat.params` by sessionID. **SPIKE:** whether `session.create` accepts provider/model directly; evaluate `experimental.provider.small_model`. |
| **Direct transport (opt-in)** | `reducerTransport: "direct"`: call the provider HTTP API with credentials from the `auth`/`provider` hooks. Cheapest (~300 instruction tokens + log) but the plugin touches secrets — ship behind explicit config with SECURITY.md parity. |
| **Timeout / abort** | Keep Pi semantics: `timeoutMs` config, abort on timeout → journal `model-call-timeout` → fallback. |
| **Cache** | Core `ReceiptCache` with the identical cache key (`storeRoot`, archive hash, command, `isError`, provider, model, `maxOutputTokens`, schema, instructions); cache hits reuse evidence with zeroed usage. |
| **Degradation** | Every failure path journals a `fallback` reason and returns the original untouched: unverifiable quote, model error, receipt-not-smaller, secret-like content. |

### 5.4 Online Context Compact

| Concern | Design |
|---|---|
| **Plan source** | **Native todos (recommended):** `todo.updated` bus events carry the full todo list; adapter maps to core `PlanStep` (`goal ← content`) and reuses `analyzePlanTransition` to detect newly completed steps → `pendingBoundary`. No new tool to teach; OpenCode's prompts already drive todo usage. (Config escape hatch: register a dedicated `update_plan` tool if richer semantics prove necessary.) |
| **Request tick + token estimate** | The kernel's `onRequestTick` (fed by `messages.transform`, shared with ObservationPack, ordered before projection) counts provider requests and sums `estimateTokens` over parts + a system estimate — replacing Pi's `before_provider_request` + `getContextUsage`. |
| **Decision point** | `session.idle` (≈ Pi's `turn_end` + `agent_settled` combined, but no abort needed — the turn is already over): if `pendingBoundary` and not aux-session activity, run core `decideCompaction` with `writeTokens` = last context estimate, `archiveTokens ≈ max(0, contextTokens − keepRecentTokens) + priorSummaryTokens` (an approximation of Pi's `estimateNativeCompactionTokens`; the decision is economic, not exact — document it), `memoTokens = 1000`, `contextWindowTokens` from provider metadata if available, `cacheWriteReadRatio` from config (default 12.5). All break-even/debt/margin gates reused verbatim from `economics.ts`. |
| **Trigger + instructions** | Set `experimental.compaction.autocontinue` `enabled = true`, then `client.session.summarize({ sessionID, ... })` (**SPIKE:** `auto` flag semantics; provider/model routing). `experimental.session.compacting` fires for our compaction → mutate `prompt` to inject `BOUNDARY_COMPACTION_INSTRUCTIONS` ("Preserve completed work, verification results, important decisions, and remaining work"). |
| **Non-looping continuation** | On `session.compacted` → record state (core `recordCompaction`, debt tracking) → on next `session.idle`, if autocontinue did not already resume, send **one** continuation via `client.session.prompt_async` containing the plan reminder + `formatPlanSnapshot`. **Loop guards:** (1) `pendingBoundary` is consumed on use — no new completed step, no new compaction; (2) hard cap `maxAutoContinuations` per session (default 3, OpenCode-specific addition); (3) in-flight flag prevents double-continuation; (4) subsequent-compaction margin + carried-debt gates from `economics.ts` price cache-write loss. |
| **State** | Core `OnlineState` (boundary request counts, compaction count, debt) persisted to `online-context-compact/state.json` per session; loaded on session start. (Pi used custom session-log entries, which have no OpenCode equivalent — the JSON file is the honest substitute.) |
| **Degradation** | `summarize` failure → log, reset in-flight, task continues un-compacted. Never blocks the agent: everything runs at idle. |

### 5.5 Trajectory Inspector

| Pi concept | OpenCode mapping |
|---|---|
| **18 event hooks** | Single `event` hook fan-out. Verified events: `message.updated` (assistant message span: running → ok/error), `message.part.updated` (first part of an assistant message opens the span; too noisy per-delta — record one span per message), `tool.execute.before`/`after` (tool spans keyed by `callID`, with duration), `session.compacted` (compaction record), `session.error`, `session.status`, `session.idle` (turn-end synthesis — no turn events exist), `todo.updated` (plan transitions). Provider HTTP status is unavailable → omit (or surface `session.error`). |
| **TUI widget** | **Gap accepted:** no widget or command-registration API in the verified set. Replacements: (1) the durable JSONL artifact (core writer, metadata-only — kinds, timestamps, statuses, names, byte counts, correlation ids; never prompts/args/output, parity with the README's guarantees); (2) a read-only diagnostic tool `sol_trajectory` registered via the `tool` hook that dumps the last N ring-buffer records; (3) a tiny CLI in the repo (`packages/opencode/bin/sol-trajectory tail -f <project-slug>`) for a live terminal view. Revisit if OpenCode ships widget/command registration. |
| **`/trajectory` command** | Not portable (no verified command-registration hook) — the tool + CLI above replace it. |

**Ship it first:** it is the measurement instrument for every later phase's evals.

---

## 6. Coexistence policy

1. **Built-in truncation:** leave `tool_output.max_lines`/`max_bytes` at defaults. ObservationPack's 10 KiB threshold operates below the 50 KiB truncation point; >50 KiB results are archived from `metadata.outputPath`. Never raise the limits to "help" packing — it would push more bytes into context.
2. **Reducer → ObservationPack ordering:** the reducer shrinks output in `tool.execute.after`, before the part exists; receipts land below threshold and are additionally exempted by the receipt-prefix check. No runtime ordering conflict.
3. **Auto-compaction:** with `onlineContextCompact` enabled, disable OpenCode's size-based auto-compaction with `"compaction": { "auto": false }` (or the `OPENCODE_DISABLE_AUTOCOMPACT` environment variable). A `config` hook exists (`config?: (input: Config) => Promise<void>`) but OpenCode treats it as a one-way notification (return ignored; mutation not honored reliably), so this stays a documented configuration requirement rather than something the plugin sets. With only ObservationPack/Fusion/Reducer enabled, leave auto-compaction on — placeholders are compaction-stable (§5.2).
4. **Prompt-cache impact:** transforms cost one suffix re-read per replaced part (prefix caching invalidates from the first changed byte). Mitigations already in the design: first 2 requests untouched (cache-critical early phase), placeholder bytes deterministic (stable prefix after the one-time swap), and OCC's economics explicitly price the cache-write loss via `cacheWriteReadRatio` (default 12.5). Measure the 90%→85%-style hit-rate delta in Phase 3 evals before tuning `fullSends`.

---

## 7. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| After-hook failure signal unknown (Fusion skip semantics) | High | Day-one spike (§5.1); fallback = run-and-label, documented deviation. |
| Part/message payload shapes in `messages.transform` unverified | High | Day-one spike; kernel isolates shape knowledge behind one module so changes are one-file fixes. |
| Reentrancy: reducer child sessions + compaction requests flow back through `messages.transform`/event hooks | High | Kernel `isAuxSession` gate: projection, request ticks, and trajectory spans skip aux sessions; child sessionIDs marked at creation. |
| OCC continuation loops | High | Boundary-consumed trigger, `maxAutoContinuations` cap, in-flight flag, debt/margin gates (§5.4). |
| Cache invalidation from transforms | Medium | Deterministic placeholders, `fullSends=2`, measured in Phase 3; `fullSends` configurable. |
| Child-session cost/latency (reducer) | Medium | System-prompt replacement via `system.transform`; `ReceiptCache`; timeout → fallback; `direct` transport opt-in. |
| Privacy: archives on disk; logs sent to reducer model | Medium | `0600`/`0700` + `O_NOFOLLOW` + EEXIST-verify (ported); `LIKELY_SECRET` gate; SECURITY.md parity; reducer off by default. |
| Experimental-hook instability (`experimental.*` may change) | Medium | Capability detection at plugin start: missing hook → disable that mechanism, log once, fail open. Pin `@opencode-ai/plugin` range tightly; CI matrix against OpenCode stable + latest. |
| Hook-chain ordering with third-party plugins | Low | Mechanisms tolerate foreign mutations (they re-read current state each hook); document "SoL assumes it may not be last in the chain." |
| `obs_recall` recall-churn (recall results get packed, model recalls again) | Low | Parity default (no exemption); `packRecallResults: false` flag ready; watch in evals. |

---

## 8. Test strategy

1. **Core unit tests:** port SoL-Pi's vitest suites into `packages/core` — `economics.ts`/`plan.ts` (decision table incl. debt/margin gates), `observation.ts` (placeholder determinism, UTF-8-safe search/paging, EEXIST-verify, symlink refusal), `receipt.ts` (byte-for-byte quote verification, `missing-failure-evidence`, schema mismatch), `file-queue.ts` (canonical keys, missing-path resolution), `ReceiptCache` LRU. These are the majority of the correctness surface and are pure.
2. **Adapter integration (headless):** `apps/e2e` boots an OpenCode server via the SDK with the plugin installed and a **mock provider** (local OpenAI-compatible endpoint) — no real API, deterministic. Scripted sessions drive: a fused edit+command; a tool emitting a 2 MiB result (assert archive created, request-3 payload contains the placeholder, `obs_recall` pages match); a failing build log through the reducer (assert receipt applied / fallback on bad quotes); todo completion → `summarize` called once, continuation sent once, no loop. **SPIKE seam:** whether `experimental.text.complete` can serve as an in-process mock provider.
3. **Token-savings measurement (credible):** the mock provider records exact request payloads server-side → per-request input/cacheRead/cacheWrite token counts, A/B with each mechanism on/off. Cross-check against the mechanisms' own ledgers (`observation-pack/ledger.jsonl` logs per-request full/placeholder token deltas; reducer journal logs usage) — ledger and provider-side counts must agree. Report: total input tokens, request count, wall time, task success on a fixed task set.
4. **Trajectory as test instrumentation:** Phase 1's JSONL doubles as the trace for debugging every later mechanism's eval runs.

---

## 9. Phased implementation plan

| Phase | Delivers | Proves |
|---|---|---|
| **0 — Core extraction** | `@alicekk/sol-opencode-core` + ported tests; SoL-Pi migrated to consume it (separate coordinated PR); parity CI job | The no-fork sharing story; neutral types suffice for both harnesses |
| **1 — Trajectory** | Event mapping, runtime root, JSONL, diagnostic tool, tail CLI | Event vocabulary, storage layout, and the measurement instrument — at zero risk to agent behavior |
| **2 — Action Fusion** | `tool.definition`/before/after wiring, `$` execution, failure-signal spike resolved | Schema injection + arg stashing works; turn-count drop measurable |
| **3 — ObservationPack** | `messages.transform` projection, `obs_recall`, `outputPath` archives | The flagship token saver; stateless send counting; cache-hit delta measured |
| **4 — Reducer** | Child-session transport, receipt validation, cache, journal | Auxiliary model calls on verified APIs only; fallback fidelity |
| **5 — Online Context Compact** | Todo-based boundaries, `summarize` + autocontinue + guards | The riskiest loop-adjacent behavior, landed last with all instrumentation in place |

Each phase ends with the A/B eval from §8.3; a mechanism that does not measure positive gets its defaults flipped off before release.

---

## 10. Open decisions for the human

| # | Decision | Recommendation | Alternatives / notes |
|---|---|---|---|
| 1 | Core distribution | **npm `@alicekk/sol-opencode-core`** | Vendored checksum-verified sync script as fallback. npm forces a publish workflow on SoL-Pi releases — **pick one; do not live with both**. |
| 2 | Storage root | **XDG data dir** (`$SOL_OPENCODE_HOME` or `~/.local/share/sol-opencode`) | Project-local `.sol/` is visible and gitignorable but touches the worktree. |
| 3 | Reducer transport default + model/provider | **`child-session`**; reducer **off** by default; `direct` only behind explicit config (or defer past v1) | `direct` is cheaper (~300 instruction tokens + log) but the plugin touches credentials. |
| 4 | OCC plan source | **Native todos** (`todo.updated`, `goal ← content`) | Dedicated `update_plan` tool as a config escape hatch if richer semantics prove necessary. |
| 5 | Auto-compaction policy | **Force-disable built-in auto-compaction via the `config` hook when OCC is on** | Warn-only alternative; `forceKeepAutoCompaction` escape hatch. Exact config key pending spike #7. |
| 6 | `obs_recall` exemption from packing | **Parity: no exemption** | `packRecallResults: false` flag ships ready; watch recall-churn in evals. |
| 7 | Naming / branding | ✅ Decided: `@alicekk/sol-opencode-core` (core) + `@alicekk/sol-opencode` (plugin) | Extracted files keep their upstream NVIDIA SPDX headers (MIT attribution); new adapter files may carry the maintainer's copyright. |

All recommendations already match the defaults in §4.2 and Oracle's blueprint; none is irreversible before implementation begins.

---

## 11. Verification spikes (consolidated)

Resolve these **before** the phase that depends on them. Each is a small, targeted probe, not a redesign.

| # | Spike | Status | Resolution / note |
|---|---|---|---|
| 1 | Reliable tool-call failure signal in `tool.execute.after` | ✅ Resolved | Shell completion metadata is `{ output, exit, truncated, outputPath? }` → `isError = exit !== 0`. A failed edit/write never reaches `tool.execute.after`, so the fused command is skipped automatically. |
| 2 | Bun `$` timeout/kill semantics | ⚠️ Open | `BunShell` exposes no abort/kill handle; the timeout is enforced with a race that reports failure but may leave the process running. |
| 3 | Tool-result part shape / `info.role` / transform firing | ✅ Resolved (shape) | `ToolPart = { type:"tool", callID, tool, state }`, `ToolStateCompleted.output`; one transform invocation per provider request still to confirm live. |
| 4 | `metadata.outputPath` presence | ✅ Resolved | Written only when the output is truncated; the archive falls back to the visible output otherwise. |
| 5 | Child-session transport + cleanup | ✅ Resolved (types) | `session.create/prompt/delete` typecheck against `@opencode-ai/sdk` 1.18.30; child-session visibility and cleanup still to confirm live. |
| 6 | `session.summarize` routing | ✅ Resolved (types) | Body is `{ providerID, modelID }`; `finish`/`error` drive status. |
| 7 | Disable built-in auto-compaction | ✅ Resolved | Key is `"compaction": { "auto": false }` (or env `OPENCODE_DISABLE_AUTOCOMPACT`). The `config` hook exists but is a one-way notification (mutation not honored reliably), so it is a documented config requirement when OCC is enabled. |
| 8 | Mock provider for e2e | ✅ Resolved | `experimental.text.complete` only post-processes already-streamed text (processor.ts), so it cannot originate a response; full e2e still needs a local OpenAI-compatible mock provider. Offline e2e drives the built hook surface directly (implemented in `packages/opencode/test/mechanisms.test.ts`). |

---

## Appendix A — Mapping from SoL-Pi (Pi) to OpenCode

| Pi API / hook | Mechanism | OpenCode equivalent |
|---|---|---|
| `pi.on("session_start")` | all | Plugin init / `config` hook |
| `pi.on("context")` (message-array projection) | ObservationPack | `experimental.chat.messages.transform` |
| `pi.on("tool_result")` | Reducer | `tool.execute.after` (output replacement) + `metadata.outputPath` |
| `pi.registerTool(...)` | Fusion, ObservationPack, Trajectory | `tool` hook (zod schemas) |
| `createEditToolDefinition` / `createWriteToolDefinition` | Fusion | `tool.definition` (schema injection on built-ins) |
| `createBashToolDefinition` | Fusion | `input.$` (Bun shell) |
| `context.compact()` | Online Context Compact | `client.session.summarize` + `experimental.compaction.autocontinue` |
| `pi.on("turn_end")` / `agent_settled` | Online Context Compact | `session.idle` |
| `context.getContextUsage()` / `before_provider_request` | Online Context Compact | kernel `onRequestTick` (`messages.transform`) |
| `pi.appendEntry(...)` (session-log state) | Online Context Compact, Reducer | per-session JSON/JSONL files under the storage root |
| 18 lifecycle events + `setWidget` + `registerCommand` | Trajectory | single `event` hook + JSONL + diagnostic tool + tail CLI |
| Pi `modelRegistry` + auth (`complete`) | Reducer | child session (`session.create` + `session.prompt`) or `auth`/`provider` hooks for a direct call |
| `ctx.sessionManager.getSessionDir()` | all | kernel `sessionRoot()` (we own the root) |
| `getAgentDir()` / `CONFIG_DIR_NAME` | config | `opencode.json` plugin config + our own loader |
