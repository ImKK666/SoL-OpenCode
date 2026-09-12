# @alicekk/sol-opencode-core

Harness-agnostic core for the **SoL-OpenCode** project, extracted from NVIDIA's
[SoL-Pi](https://github.com/NVlabs/SoL-Pi) with harness-specific glue removed.

**Zero runtime dependencies** — `node:*` builtins only. Ships uncompiled
TypeScript source.

## Modules

- `compact/` — compaction economics and plan transitions (pure)
- `observation-pack/` — content-addressed archive, placeholders, paged/literal recall
- `reducer/` — receipt validation with byte-for-byte quote checks, archive, LRU cache, policy gates
- `trajectory/` — bounded record store and batched JSONL writer
- `action-fusion/` — per-canonical-path queue, path resolution, then-run orchestration

Consumed by [`@alicekk/sol-opencode`](https://www.npmjs.com/package/@alicekk/sol-opencode),
the OpenCode plugin.

## License

MIT. Extracted files retain their upstream SPDX copyright notice.
