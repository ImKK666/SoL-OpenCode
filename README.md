# SoL-OpenCode

**简体中文** | [English](./README.en.md)

把 NVIDIA SoL-Pi 的上下文与工具效率机制移植到 [OpenCode](https://opencode.ai)
的独立插件。**所有机制默认关闭、按需开启**（opt-in）。

> 状态：五个机制均已实现、有单元测试，并已在真实的 **Terminal-Bench 4.0**
> 基准上测得数据。见[跑分](#跑分)。

## 目录结构

```
packages/
├── core/       @alicekk/sol-opencode-core     — 与框架无关的纯逻辑，零依赖
└── opencode/   @alicekk/sol-opencode — OpenCode 插件本体（依赖 core）
apps/
├── e2e/        确定性 mock A/B + 真实模型 A/B 测试台
└── bench/      dev 套件、held-out 纪律、Terminal-Bench 4 接入
DESIGN.md                            — 移植设计与分阶段计划
```

## 环境要求

- Node.js 22.19 或更高
- [Bun](https://bun.sh)（用于安装依赖；npm 10 与 vitest 的 peer 依赖图有 arborist bug）
- 支持插件的 OpenCode（`@opencode-ai/plugin` 1.18.30）

## 安装

**不需要 `npm install`。** OpenCode 启动时会用 Bun 自动安装 npm 插件，缓存到
`~/.cache/opencode/` 下。

把插件加进 OpenCode 配置即可——项目级用根目录的 `opencode.json`，全局用
`~/.config/opencode/opencode.json`——然后重启 OpenCode：

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

选项写在 `["包名", { … }]` 元组的**第二项**；某个键不写，对应机制就保持关闭。只写
字符串 `"@alicekk/sol-opencode"` 则五个机制全关。

完整选项说明、验证方式与最省心的起步配置见
[`packages/opencode/README.md`](./packages/opencode/README.md)（含中文快速开始）。

## 机制

| 机制 | 状态 | 说明 |
|---|---|---|
| **Trajectory Inspector** | ✅ | 只记录元数据的 JSONL（轮次、工具调用、压缩）。不存提示词、参数、输出。 |
| **Action Fusion** | ✅ | `edit`/`write` 可带一个 `then_run`，命令在同一次调用里执行。 |
| **ObservationPack** | ✅ | 超过 `thresholdBytes` 的结果转成 `obs_<id>` 句柄，可按页/按原文精确召回。 |
| **Evidence-Preserving Reducer** | ✅ | 冗长诊断日志经子会话压缩为**可校验**的回执。 |
| **Online Context Compact** | ✅ | 计划感知的经济型压缩（走 `session.summarize`），带循环保护。 |

### Trajectory Inspector

数据写入：

```
<SOL_OPENCODE_HOME 或 ~/.local/share/sol-opencode>/<project-slug>/<session-id>/
└── trajectory-inspector/events.jsonl
```

两种查看方式：

- **`sol_trajectory` 工具** —— 让运行中的 agent 导出最近的记录。
- **命令行** —— `node packages/opencode/bin/sol-trajectory.mjs <命令>`：
  - `sessions [project-slug]` —— 列出项目 slug 或会话目录
  - `show <session-path>` —— 打印已记录事件
  - `tail <session-path>` —— 跟随事件文件

**没有**移植 TUI 实时组件：OpenCode 未提供经验证的 widget 注册 API（见
`DESIGN.md` §5.5）。

## Core（`@alicekk/sol-opencode-core`）

与框架无关、只用 `node:*` 的模块，为将来的 Pi 适配器共用：

- `compact/` —— 压缩经济学与计划转移（纯函数）
- `observation-pack/` —— 内容寻址归档、占位符、分页/原文召回
- `reducer/` —— 回执校验（逐字节引用比对）、归档、LRU 缓存、策略门
- `trajectory/` —— 有界记录存储与批量 JSONL 写入
- `action-fusion/` —— 按规范化路径排队与路径解析

## 跑分

分两半，与上游「训练环境 / held-out 集」的划分方式一致：

| 半区 | 数据集 | 纪律 |
|---|---|---|
| **dev** —— [`apps/bench`](./apps/bench/README.md) | 6 个合成 verifier 任务 | 可查看、可自由迭代 |
| **held-out** —— [`apps/bench/tb`](./apps/bench/tb/README.md) | Terminal-Bench 4.0 的 63 个 CPU-only 任务 | 冻结候选、一次性、只作报告 |

held-out 半区把上游 SoL-Pi 的协议**用代码强制**：候选被冻结（插件版本 + 源码哈希
+ 钉住的 npm 制品 + 评测集哈希）；候选漂移则拒绝运行；一次冻结只评一次；dev 与
held-out 不得相交。结果写入只增不改的账本。

### 机制正确性（确定性，mock provider）

同一段脚本化对话，插件开 vs 关——无模型随机性
（[`apps/e2e`](./apps/e2e/README.md)）：

| 场景 | 请求数 | 提示词字符 | 工具输出字符 |
|---|---|---|---|
| observation-pack | 6 → 6 | −12.1% | −58.7% |
| action-fusion | 3 → 2 | −33.5% | −4.7% |
| reducer | 4 → 4 | −16.9% | −95.1% |

### 真实模型效果（`opencode-go/deepseek-v4.1-flash`，5 次中位数）

单任务——「跑 `npm test`，把 bug 修到 123 个测试全过」——每次都在同一基线的干净副本上：

| 指标 | 插件关 | 插件开 | 差异 |
|---|---|---|---|
| 成功率 | 1.0 | 1.0 | — |
| 总 tokens | 26,617 | 13,228 | **−50.3%** |
| 成本（USD） | 0.0044 | 0.0025 | **−43.6%** |
| 墙钟 | 10.4 s | 24.5 s | +136% |

两臂都修好了 bug。tokens 与成本大致减半；墙钟上升是因为 reducer 多了一次子会话
模型调用——这是**真实权衡**，不是免费午餐。

### Terminal-Bench 4 配对探针（真基准，N=1）

TB 4.0、`html-js-filter`、`opencode-go/deepseek-v4.1-flash`，两臂各一次——在上游所用
的真实基准上的首次测量：

| | control（无插件） | treatment（插件全开） | 差异 |
|---|---|---|---|
| reward | 0.0 | 0.0 | — |
| input tokens | 11,402,619 | 4,410,582 | **−61.3%** |
| 成本（USD） | 0.1249 | 0.0826 | **−33.9%** |
| 墙钟 | 34m55s | 28m17s | −19.0% |
| 异常 | 0 | 0 | — |

两臂确实不同（control 容器日志里 `sol-opencode` 命中 **0** 次，treatment 命中 8 次，
含一份 reducer 回执）。**但两臂都没有解出该任务，所以这还不能说明能力被保住**——
它只证明机制在真实基准任务上能工作。成本实况：约 **$0.08/任务**，全量约 **$10**；
真正的瓶颈是时间（约 **30 分钟/任务**）。

### 与上游 SoL-Pi 的对比

SoL-Pi（NVIDIA）的效率数据是在 **Pi** 上测的。本移植**只做方向性对比**——框架、
模型、任务都不同：

| 来源 | 设置 | 结论 |
|---|---|---|
| SoL-Pi（已发表） | vs Pi，EdgeBench | tokens 少 45–49%，成本约降 ⅓，约为 Pi 分数的 ~94% |
| SoL-Pi（已发表） | Terminal-Bench 4（63 题） | 解出 15/63 @ $211，Pi 为 18/63 @ $286 |
| SoL-OpenCode（本仓库） | vs 插件关，1 任务，N=5 | tokens −50.3%，成本 −43.6%，成功率 100% |
| SoL-OpenCode（本仓库） | Terminal-Bench 4，1 任务，N=1 | tokens −61.3%，成本 −33.9%，**能力未测** |

token 降幅与上游 vs-Pi 的量级相当，但**这些都不是同口径对比**。上游还报告了能力代价
（约为 Pi 分数的 ~94%；TB4 上 15/63 vs 18/63）。请把以上当作方向性 sanity check，
而非对等的性能声明。

### 路线图

- ⬜ 跑完整 63 题 held-out（能力与效率同时给出，约 $10）
- ⬜ 真·1:1：**Pi + SoL-Pi 对比 OpenCode + SoL-OpenCode**（同一模型；Harbor 自带
  `pi` agent，现已可达）
- ⬜ 逐机制消融

## 开发

```bash
bun install
bun run check       # tsc --noEmit + vitest
bun run e2e:all     # 确定性 mock A/B（baseline/observation-pack/action-fusion/reducer）
bun run e2e:real 5  # 真实模型 A/B，5 轮（opencode-go/deepseek-v4.1-flash）
bun run bench       # dev 套件，能力门 + 效率门
```

## 社区

本项目认可并链接 [LINUX DO](https://linux.do) 社区。

## 许可证

MIT。
