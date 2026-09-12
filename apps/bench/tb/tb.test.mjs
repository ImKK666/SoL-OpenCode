/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Pins the two things that would silently corrupt a held-out result: the arm
 * overlay (the only difference between control and treatment) and the parse of
 * Harbor's result schema.
 */
import { describe, expect, it } from "vitest";

import { opencodeConfig, providerBlock } from "./overlay.mjs";
import { parseTrial, summarizeTrials } from "./parse.mjs";

const CATALOGUE = { "opencode-go": { npm: "@ai-sdk/openai-compatible", api: "https://opencode.ai/zen/go/v1" } };
const MODEL = "opencode-go/deepseek-v4.1-flash";
const SPEC = "@alicekk/sol-opencode@0.1.0";

describe("opencodeConfig", () => {
	it("gives the control arm the provider but no plugin", () => {
		const config = opencodeConfig("control", MODEL, CATALOGUE, SPEC);
		expect(config.plugin).toBeUndefined();
		expect(config.provider["opencode-go"].options.baseURL).toBe("https://opencode.ai/zen/go/v1");
		expect(config.provider["opencode-go"].npm).toBe("@ai-sdk/openai-compatible");
	});

	it("gives the treatment arm the pinned plugin with all five mechanisms", () => {
		const config = opencodeConfig("treatment", MODEL, CATALOGUE, SPEC);
		expect(config.plugin[0][0]).toBe(SPEC);
		expect(Object.keys(config.plugin[0][1])).toHaveLength(5);
		expect(config.provider["opencode-go"].models["deepseek-v4.1-flash"]).toEqual({});
	});

	it("refuses a treatment arm with no pinned plugin spec", () => {
		expect(() => opencodeConfig("treatment", MODEL, CATALOGUE)).toThrow(/frozen plugin spec/);
	});

	it("rejects a model id with no provider", () => {
		expect(() => providerBlock("nope", CATALOGUE)).toThrow(/provider\/model/);
	});
});

describe("parseTrial", () => {
	it("reads the real Harbor trial schema", () => {
		const trial = parseTrial({
			task_name: "terminal-bench/html-js-filter",
			agent_result: { n_input_tokens: 1000, n_output_tokens: 200, cost_usd: 0.02 },
			verifier_result: { rewards: { reward: 1.0 } },
			exception_info: null,
		});
		expect(trial).toEqual({ task: "html-js-filter", solved: true, errored: false, tokens: 1200, cost: 0.02 });
	});

	it("treats a missing reward as unsolved and a missing agent_result as zero cost", () => {
		const trial = parseTrial({
			task_name: "terminal-bench/x",
			agent_result: null,
			verifier_result: null,
			exception_info: "boom",
		});
		expect(trial.solved).toBe(false);
		expect(trial.tokens).toBe(0);
		expect(trial.cost).toBe(0);
		expect(trial.errored).toBe(true);
	});

	it("summarizes a run", () => {
		const summary = summarizeTrials([
			{ solved: true, errored: false, tokens: 10, cost: 0.1 },
			{ solved: false, errored: false, tokens: 5, cost: 0.05 },
		]);
		expect(summary).toEqual({ total: 2, solved: 1, errored: 0, tokens: 15, cost: 0.15 });
	});});
