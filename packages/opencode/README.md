# @alicekk/sol-opencode

[简体中文](https://github.com/ImKK666/SoL-OpenCode/blob/main/README.md) | **English**

An [OpenCode](https://opencode.ai) plugin that ports the five token-efficiency
mechanisms from NVIDIA's [SoL-Pi](https://github.com/NVlabs/SoL-Pi).

Every mechanism is **opt-in and off by default** — installing the plugin changes
nothing until you enable at least one.

- Repository: <https://github.com/ImKK666/SoL-OpenCode>
- Measured effect: ~61% fewer tokens on a real Terminal-Bench task (N=1; see the
  repo README for the numbers and their limits)

---

## 中文快速开始

**不需要 `npm install`。** OpenCode 启动时会用 Bun 自动安装 npm 插件，缓存到
`~/.cache/opencode/node_modules/`。

在 OpenCode 配置里加上插件即可：

- 项目级：项目根目录的 `opencode.json`
- 全局：`~/.config/opencode/opencode.json`

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "compaction": { "auto": false },
  "plugin": [
    ["@alicekk/sol-opencode", {
      "trajectoryInspector": { "enabled": true },
      "actionFusion": { "enabled": true },
      "observationPack": { "enabled": true },
      "evidencePreservingReducer": { "enabled": true },
      "onlineContextCompact": { "enabled": true }
    }]
  ]
}
```

上面是**五个机制全开**。`compaction.auto: false` 是 `onlineContextCompact`
生效的前提。重启 OpenCode 生效。

**插件本身默认全部关闭**，只写 `"@alicekk/sol-opencode"`（字符串形式）则一个都不开；
上面的全开是你显式配置的结果。选项写在 `["包名", { … }]` 元组的**第二项**。

想最省心地起步，只开这两个（都不改写工具输出内容）：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["@alicekk/sol-opencode", {
      "trajectoryInspector": { "enabled": true },
      "actionFusion": { "enabled": true }
    }]
  ]
}
```

验证是否加载成功：

```bash
npx -p @alicekk/sol-opencode sol-trajectory sessions
```

若目录一直为空，说明插件没加载——检查包名是否精确为
`@alicekk/sol-opencode`，并确认已重启 OpenCode。

开启 `onlineContextCompact` 时，请同时设置 `"compaction": { "auto": false }`，
避免与 OpenCode 内置的按体积压缩互相竞争。

**隐私：** trajectory inspector 只记录元数据（不含提示词、参数、输出）；
仅 reducer 在启用后会把符合条件的诊断日志发给模型，它默认关闭。
归档目录默认在 `~/.local/share/sol-opencode`。

完整机制说明与选项默认值见下方英文部分。

---

## Requirements

- OpenCode with plugin support (`@opencode-ai/plugin` ≥ 1.18.30)
- Node.js ≥ 22.19 — only needed for the optional `sol-trajectory` CLI

## Install

**No `npm install` step.** OpenCode installs npm plugins itself with Bun at
startup and caches them under `~/.cache/opencode/`.

Add the plugin to your OpenCode config:

- per project → `opencode.json` in the project root
- global → `~/.config/opencode/opencode.json`

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "compaction": { "auto": false },
  "plugin": [
    ["@alicekk/sol-opencode", {
      "trajectoryInspector": { "enabled": true },
      "actionFusion": { "enabled": true },
      "observationPack": { "enabled": true },
      "evidencePreservingReducer": { "enabled": true },
      "onlineContextCompact": { "enabled": true }
    }]
  ]
}
```

Restart OpenCode. That enables **all five mechanisms**; `compaction.auto: false`
is what lets `onlineContextCompact` work without competing with the built-in
compaction. Options are the **second element** of the `["package", { … }]` tuple,
and a string-only entry (`"@alicekk/sol-opencode"`) loads the plugin with every
mechanism off — the plugin defaults to fully off.

## Enable mechanisms

| Option | Default | What it does |
|---|---|---|
| `trajectoryInspector` | off | Metadata-only JSONL of turns, tools and compactions (`{ enabled, maxRecords }`, default 12). No prompts, arguments or outputs are stored. |
| `actionFusion` | off | `edit`/`write` accept an optional `then_run`; the command runs in the same call (`{ enabled, tools }`, default `["edit","write"]`). |
| `observationPack` | off | Tool results larger than `thresholdBytes` become `obs_<id>` handles with exact paged/literal recall (`{ enabled, thresholdBytes, fullSends }`, defaults 10240 / 2). |
| `evidencePreservingReducer` | off | Long diagnostic logs are reduced to a byte-verified receipt over a child-session model call (`{ enabled, provider?, model? }`). Omit `provider`/`model` to reuse the session's model. |
| `onlineContextCompact` | off | Plan-aware, economic compaction via `session.summarize`, with loop guards (`{ enabled, cacheWriteReadRatio, keepRecentTokens, maxAutoContinuations }`, defaults 12.5 / 20000 / 3). |

### All mechanisms on

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "compaction": { "auto": false },
  "plugin": [
    ["@alicekk/sol-opencode", {
      "trajectoryInspector": { "enabled": true },
      "actionFusion": { "enabled": true },
      "observationPack": { "enabled": true },
      "evidencePreservingReducer": { "enabled": true },
      "onlineContextCompact": { "enabled": true }
    }]
  ]
}
```

> `"compaction": { "auto": false }` is only needed when `onlineContextCompact` is
> on — it stops OpenCode's built-in size-based compaction from competing with it.

### A conservative start

If you would rather not change tool-result handling immediately, this pair is the
lowest-risk entry point (neither one rewrites content):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["@alicekk/sol-opencode", {
      "trajectoryInspector": { "enabled": true },
      "actionFusion": { "enabled": true }
    }]
  ]
}
```

## Verify it loaded

Enable `trajectoryInspector`, then inspect what it recorded:

```bash
npx -p @alicekk/sol-opencode sol-trajectory sessions
```

Events are written under `$SOL_OPENCODE_HOME` (default
`~/.local/share/sol-opencode`). If the directory stays empty, the plugin did not
load — check that the package name is spelled exactly `@alicekk/sol-opencode`
and that you restarted OpenCode.

You can also ask the running agent to dump recent records with the bundled
`sol_trajectory` tool.

## CLI

```bash
npx -p @alicekk/sol-opencode sol-trajectory sessions [project-slug]   # list sessions
npx -p @alicekk/sol-opencode sol-trajectory show <session-path>       # print events
npx -p @alicekk/sol-opencode sol-trajectory tail <session-path>       # follow events
```

## Data, privacy and security

- Archives and metadata go under `$SOL_OPENCODE_HOME` (default
  `~/.local/share/sol-opencode`), per project and session.
- The **trajectory inspector stores no prompts, arguments or outputs** — only
  metadata (turn/tool/compaction shape).
- The **reducer is the only mechanism that sends content to a model** (eligible
  diagnostic logs, via a child session), and it is off by default.
- Everything else runs locally.

See `SECURITY.md` in the repository for the full data-flow description.

## Community

This project acknowledges and links to the [LINUX DO](https://linux.do) community.

## License

MIT. Ported mechanisms retain their upstream NVIDIA SPDX headers; see
`THIRD_PARTY_NOTICES.md` in the repository.
