/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Real-model A/B benchmark.
 *
 * Methodology:
 *   - one immutable baseline fixture (apps/e2e/fixtures/benchmark-app)
 *   - every run gets its OWN copy of the baseline, so no run can affect another
 *     and all runs start from identical code
 *   - the same task prompt and the same model are used for control and treatment
 *   - control = plugin off, treatment = plugin with all mechanisms enabled
 *   - token/cost metrics are parsed from `opencode run --format json` per run
 *   - each run is repeated N times; results are compared by median
 *
 * Usage: node real.mjs [rounds] [--model provider/model]
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, "fixtures/benchmark-app");
const PLUGIN_DIR = resolve(HERE, "../../packages/opencode");
const OPENCODE = process.env.OPENCODE_BIN ?? join(process.env.HOME ?? "", ".opencode/bin/opencode");
const AUTH = join(process.env.HOME ?? "", ".local/share/opencode/auth.json");
const MODELS = join(process.env.HOME ?? "", ".cache/opencode/models.json");

const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
const TASK =
	"Run `npm test`. Some tests fail. Find and fix the bug in src/stack.js so that all tests pass. Verify by running `npm test`.";

const TREATMENT_PLUGIN = {
	trajectoryInspector: { enabled: true },
	actionFusion: { enabled: true },
	observationPack: { enabled: true },
	evidencePreservingReducer: { enabled: true, provider: "opencode-go", model: "deepseek-v4.1-flash" },
	onlineContextCompact: { enabled: true },
};

function parseMetrics(stdout) {
	let input = 0;
	let output = 0;
	let reasoning = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	let steps = 0;
	for (const line of stdout.split("\n")) {
		if (line.trim() === "") continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type !== "step_finish" || !event.part?.tokens) continue;
		steps += 1;
		input += event.part.tokens.input ?? 0;
		output += event.part.tokens.output ?? 0;
		reasoning += event.part.tokens.reasoning ?? 0;
		cacheRead += event.part.tokens.cache?.read ?? 0;
		cacheWrite += event.part.tokens.cache?.write ?? 0;
		if (typeof event.part.cost === "number") cost += event.part.cost;
	}
	return { steps, input, output, reasoning, cacheRead, cacheWrite, totalTokens: input + output, cost };
}

async function runOnce({ mode, round, root, model, task }) {
	const dir = join(root, `r${round}-${mode}`);
	const project = join(dir, "project");
	const home = join(dir, "home");
	mkdirSync(project, { recursive: true });
	cpSync(BASELINE, project, { recursive: true });
	// Fully isolated HOME, seeded with only what a real provider needs: the
	// model catalogue and the auth credentials. The developer's global config
	// (and its plugins) never loads.
	mkdirSync(join(home, ".cache", "opencode"), { recursive: true });
	mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
	if (existsSync(MODELS)) cpSync(MODELS, join(home, ".cache", "opencode", "models.json"));
	if (existsSync(AUTH)) cpSync(AUTH, join(home, ".local", "share", "opencode", "auth.json"));

	const config = { $schema: "https://opencode.ai/config.json" };
	if (mode === "treatment") config.plugin = [[PLUGIN_DIR, TREATMENT_PLUGIN]];
	writeFileSync(join(project, "opencode.json"), JSON.stringify(config, null, 2));

	const env = {
		...process.env,
		HOME: home,
		OPENCODE_CONFIG: join(project, "opencode.json"),
		PWD: project,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"),
		XDG_CACHE_HOME: join(home, ".cache"),
	};
	delete env.OPENCODE;
	delete env.OPENCODE_PID;
	delete env.OLDPWD;

	const started = Date.now();
	const result = await new Promise((resolveRun) => {
		const child = spawn(
			OPENCODE,
			["run", task, "-m", model, "--format", "json", "--print-logs", "--log-level", "ERROR"],
			{ cwd: project, env, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60 * 1000);
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("close", (code) => {
			clearTimeout(timer);
			resolveRun({ code, stdout, stderr });
		});
	});
	const wallMs = Date.now() - started;

	// Task success = the baseline bug is actually fixed (all tests pass).
	const testRun = spawnSync("npm", ["test"], { cwd: project, env, stdio: "ignore" });
	const testPassed = testRun.status === 0;

	return {
		mode,
		round,
		model,
		exitCode: result.code,
		wallMs,
		testPassed,
		metrics: parseMetrics(result.stdout),
		stderrTail: result.stderr.slice(-300),
	};
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarize(runs) {
	const pick = (key) => median(runs.map((run) => run.metrics[key]));
	return {
		runs: runs.length,
		successRate: runs.filter((run) => run.testPassed).length / runs.length,
		wallMs: Math.round(median(runs.map((run) => run.wallMs))),
		steps: pick("steps"),
		input: pick("input"),
		output: pick("output"),
		cacheRead: pick("cacheRead"),
		cacheWrite: pick("cacheWrite"),
		totalTokens: pick("totalTokens"),
		cost: pick("cost"),
	};
}

const args = process.argv.slice(2);
const rounds = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 1);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : DEFAULT_MODEL;
const task = args.includes("--task") ? args[args.indexOf("--task") + 1] : TASK;
const root = join(tmpdir(), `sol-real-${Date.now()}`);
mkdirSync(root, { recursive: true });

console.log(`real A/B: ${rounds} round(s), model=${model}\nbaseline=${BASELINE}\nworkspace=${root}\n`);
const collected = { control: [], treatment: [] };
for (let round = 1; round <= rounds; round += 1) {
	for (const mode of ["control", "treatment"]) {
		process.stdout.write(`  round ${round} ${mode} … `);
		const run = await runOnce({ mode, round, root, model, task });
		collected[mode].push(run);
		console.log(
			`exit=${run.exitCode} tests=${run.testPassed ? "pass" : "FAIL"} steps=${run.metrics.steps} ` +
				`in=${run.metrics.input} out=${run.metrics.output} cacheR=${run.metrics.cacheRead} cost=${run.metrics.cost.toFixed(4)} ` +
				`wall=${(run.wallMs / 1000).toFixed(1)}s`,
		);
	}
}

const control = summarize(collected.control);
const treatment = summarize(collected.treatment);
const pct = (before, after) => (before === 0 ? "n/a" : `${(((after - before) / before) * 100).toFixed(1)}%`);

console.log(`\n=== real A/B (median of ${rounds}) ===`);
console.log("metric        | control   | treatment | delta");
console.log("--------------|-----------|-----------|-------");
console.log(`successRate   | ${String(control.successRate).padEnd(9)} | ${String(treatment.successRate).padEnd(9)} |`);
console.log(`steps         | ${String(control.steps).padEnd(9)} | ${String(treatment.steps).padEnd(9)} | ${treatment.steps - control.steps}`);
console.log(`input tokens  | ${String(control.input).padEnd(9)} | ${String(treatment.input).padEnd(9)} | ${pct(control.input, treatment.input)}`);
console.log(`cacheRead     | ${String(control.cacheRead).padEnd(9)} | ${String(treatment.cacheRead).padEnd(9)} | ${pct(control.cacheRead, treatment.cacheRead)}`);
console.log(`cacheWrite    | ${String(control.cacheWrite).padEnd(9)} | ${String(treatment.cacheWrite).padEnd(9)} | ${pct(control.cacheWrite, treatment.cacheWrite)}`);
console.log(`output tokens | ${String(control.output).padEnd(9)} | ${String(treatment.output).padEnd(9)} | ${pct(control.output, treatment.output)}`);
console.log(`total tokens  | ${String(control.totalTokens).padEnd(9)} | ${String(treatment.totalTokens).padEnd(9)} | ${pct(control.totalTokens, treatment.totalTokens)}`);
console.log(`cost          | ${control.cost.toFixed(4).padEnd(9)} | ${treatment.cost.toFixed(4).padEnd(9)} | ${pct(control.cost, treatment.cost)}`);
console.log(`wall (s)      | ${(control.wallMs / 1000).toFixed(1).padEnd(9)} | ${(treatment.wallMs / 1000).toFixed(1).padEnd(9)} |`);
console.log("");
