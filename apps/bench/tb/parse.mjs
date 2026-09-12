/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Read Harbor job output back into per-trial outcomes.
 *
 * Schema verified against a real Harbor 0.23.0 job:
 *   <jobs>/<run>/<task>__<id>/result.json
 *     .agent_result.{n_input_tokens,n_output_tokens,cost_usd}
 *     .verifier_result.rewards.reward
 *     .exception_info
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** One Harbor trial result -> an outcome. */
export function parseTrial(record) {
	return {
		task: String(record.task_name ?? "").replace(/^terminal-bench\//, ""),
		solved: (record.verifier_result?.rewards?.reward ?? 0) >= 1,
		errored: record.exception_info != null,
		tokens: (record.agent_result?.n_input_tokens ?? 0) + (record.agent_result?.n_output_tokens ?? 0),
		cost: record.agent_result?.cost_usd ?? 0,
	};
}

/** A finished Harbor job directory -> per-trial outcomes. */
export function parseJob(runDir) {
	const trials = [];
	for (const entry of readdirSync(runDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.includes("__")) continue;
		const file = join(runDir, entry.name, "result.json");
		if (!existsSync(file)) continue;
		trials.push(parseTrial(JSON.parse(readFileSync(file, "utf8"))));
	}
	return trials;
}

/** Round to micro-dollars so summed costs stay stable and diff-friendly in the ledger. */
const microDollars = (value) => Math.round(value * 1e6) / 1e6;

export function summarizeTrials(trials) {
	return {
		total: trials.length,
		solved: trials.filter((trial) => trial.solved).length,
		errored: trials.filter((trial) => trial.errored).length,
		tokens: trials.reduce((sum, trial) => sum + trial.tokens, 0),
		cost: microDollars(trials.reduce((sum, trial) => sum + trial.cost, 0)),
	};
}
