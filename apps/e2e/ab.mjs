/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Runs a scenario twice (plugin off vs on) and prints a deterministic comparison.
 *
 * Usage: node ab.mjs <scenario>
 */
import { runScenario } from "./run.mjs";

function delta(before, after) {
	if (before === 0) return after === 0 ? "0%" : "n/a";
	return `${(((after - before) / before) * 100).toFixed(1)}%`;
}

const name = process.argv[2] ?? "baseline";
const control = await runScenario(name, "control");
const treatment = await runScenario(name, "treatment");

const c = control.metrics;
const t = treatment.metrics;

console.log(`\n=== SoL-OpenCode e2e A/B: ${name} ===`);
console.log(`exit codes: control=${control.exitCode} treatment=${treatment.exitCode}`);
console.log("");
console.log("metric                | control | treatment | delta");
console.log("----------------------|---------|-----------|-------");
console.log(`requests              | ${String(c.requests).padStart(7)} | ${String(t.requests).padStart(9)} | ${t.requests - c.requests}`);
console.log(`totalPromptChars      | ${String(c.totalPromptChars).padStart(7)} | ${String(t.totalPromptChars).padStart(9)} | ${delta(c.totalPromptChars, t.totalPromptChars)}`);
console.log(`totalPromptTokens(~4) | ${String(c.totalPromptTokens).padStart(7)} | ${String(t.totalPromptTokens).padStart(9)} | ${delta(c.totalPromptTokens, t.totalPromptTokens)}`);
console.log(`totalToolChars        | ${String(c.totalToolChars).padStart(7)} | ${String(t.totalToolChars).padStart(9)} | ${delta(c.totalToolChars, t.totalToolChars)}`);
console.log(`maxRequestChars       | ${String(c.maxRequestChars).padStart(7)} | ${String(t.maxRequestChars).padStart(9)} | ${delta(c.maxRequestChars, t.maxRequestChars)}`);
console.log("");

if (control.exitCode !== 0) console.log(`control stderr: ${control.stderrTail}`);
if (treatment.exitCode !== 0) console.log(`treatment stderr: ${treatment.stderrTail}`);
