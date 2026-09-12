/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * The dev / held-out split.
 *
 * Dev tasks are inspectable and free to iterate on (the synthetic suite in
 * `apps/bench/tasks`). Held-out tasks are declared once, frozen into the
 * manifest, and run under the one-shot discipline. The two sets must be
 * disjoint — a task you tuned on is not a held-out task.
 *
 * Held-out task ids are declared in `split.json` (so the eval set can be
 * updated without touching code) and pinned by hash inside the manifest.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hashValue } from "./candidate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPLIT_PATH = join(HERE, "split.json");

/** The synthetic suite: cheap, inspectable, used to build the harness. */
export const DEV_TASKS = ["array-chunk", "parse-duration", "queue-fifo", "range-sum", "slugify", "stack-lifo"];

const DEFAULT_SPLIT = { dev: DEV_TASKS, heldout: null };

export function loadSplit() {
	if (!existsSync(SPLIT_PATH)) return DEFAULT_SPLIT;
	return JSON.parse(readFileSync(SPLIT_PATH, "utf8"));
}

export function splitHash(split) {
	return hashValue(split);
}
