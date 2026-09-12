/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Task-suite benchmark with upstream-SoL-Pi methodology:
 *   - a suite of verifier-driven tasks (fail-before / pass-after)
 *   - two arms: plugin OFF (control) and plugin ON (treatment)
 *   - capability (solved tasks) AND efficiency (tokens / cost) reported together
 *   - a capability floor gates whether an efficiency win is admissible
 *
 * Every task x arm run gets its own copy of the task repo, so nothing is shared.
 *
 * Usage: node apps/bench/bench.mjs [--rounds N] [--model provider/model]
 *                                  [--tasks a,b,c] [--arms control,treatment] [--list]
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(HERE, "tasks");
const PLUGIN_DIR = resolve(HERE, "../../packages/opencode");
const OPENCODE = process.env.OPENCODE_BIN ?? join(process.env.HOME ?? "", ".opencode/bin/opencode");
const AUTH = join(process.env.HOME ?? "", ".local/share/opencode/auth.json");
const MODELS = join(process.env.HOME ?? "", ".cache/opencode/models.json");

const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
const CAPABILITY_TOLERANCE = 0; // solved tasks may not drop below control

const TREATMENT_PLUGIN = {
	trajectoryInspector: { enabled: true },
	actionFusion: { enabled: true },
	observationPack: { enabled: true },
	evidencePreservingReducer: { enabled: true, provider: "opencode-go", model: "deepseek-v4.1-flash" },
	onlineContextCompact: { enabled: true },
};

function parseArgs(argv) {
	const value = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
	return {
		rounds: Number(value("--rounds", "1")),
		model: value("--model", DEFAULT_MODEL),
		tasks: value("--tasks", "") === "" ? undefined : value("--tasks", "").split(","),
		arms: value("--arms", "control,treatment").split(","),
		list: argv.includes("--list"),
	};
}

function loadTasks(filter) {
	return readdirSync(TASKS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const dir = join(TASKS_DIR, entry.name);
			const meta = JSON.parse(readFileSync(join(dir, "task.json"), "utf8"));
			return { ...meta, repo: join(dir, "repo") };
		})
		.filter((task) => !filter || filter.includes(task.id))
		.sort((a, b) => a.id.localeCompare(b.id));
}

function parseMetrics(stdout) {
	let input = 0;
	let output = 0;
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
		cacheRead += event.part.tokens.cache?.read ?? 0;
		cacheWrite += event.part.tokens.cache?.write ?? 0;
		if (typeof event.part.cost === "number") cost += event.part.cost;
	}
	return { steps, input, output, cacheRead, cacheWrite, totalTokens: input + output, cost };
}

async function runTask({ task, arm, round, model, root }) {
	const dir = join(root, `${task.id}-r${round}-${arm}`);
	const project = join(dir, "project");
	const home = join(dir, "home");
	mkdirSync(project, { recursive: true });
	cpSync(task.repo, project, { recursive: true });
	mkdirSync(join(home, ".cache", "opencode"), { recursive: true });
	mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
	if (existsSync(MODELS)) cpSync(MODELS, join(home, ".cache", "opencode", "models.json"));
	if (existsSync(AUTH)) cpSync(AUTH, join(home, ".local", "share", "opencode", "auth.json"));

	const config = { $schema: "https://opencode.ai/config.json" };
	if (arm === "treatment") config.plugin = [[PLUGIN_DIR, TREATMENT_PLUGIN]];
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
			["run", task.prompt, "-m", model, "--format", "json", "--print-logs", "--log-level", "ERROR"],
			{ cwd: project, env, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60 * 1000);
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.on("close", (code) => {
			clearTimeout(timer);
			resolveRun({ code, stdout });
		});
	});
	const wallMs = Date.now() - started;
	const verifier = spawnSync(task.test, { cwd: project, env, shell: true, stdio: "ignore" });
	return { task: task.id, arm, round, solved: verifier.status === 0, wallMs, metrics: parseMetrics(result.stdout) };
}

function summarize(runs) {
	const solve = (key) => runs.reduce((total, run) => total + run.metrics[key], 0);
	return {
		runs: runs.length,
		solved: runs.filter((run) => run.solved).length,
		tokens: solve("totalTokens"),
		cost: runs.reduce((total, run) => total + run.metrics.cost, 0),
		wallMs: runs.reduce((total, run) => total + run.wallMs, 0),
	};
}

const args = parseArgs(process.argv.slice(2));
const tasks = loadTasks(args.tasks);
if (tasks.length === 0) {
	console.error("no tasks found (run `node apps/bench/generate.mjs` first)");
	process.exit(1);
}
if (args.list) {
	for (const task of tasks) console.log(task.id);
	process.exit(0);
}

const root = join(tmpdir(), `sol-bench-${Date.now()}`);
mkdirSync(root, { recursive: true });
console.log(
	`SoL-OpenCode benchmark: ${tasks.length} tasks x ${args.arms.length} arms x ${args.rounds} round(s)\n` +
		`model=${args.model}\nworkspace=${root}\n`,
);

const cols = { control: [], treatment: [] };
for (let round = 1; round <= args.rounds; round += 1) {
	for (const task of tasks) {
		const cells = [];
		for (const arm of args.arms) {
			const run = await runTask({ task, arm, round, model: args.model, root });
			cols[arm]?.push(run);
			cells.push(
				`${arm}=${run.solved ? "solved" : "FAIL"} tokens=${run.metrics.totalTokens} cost=${run.metrics.cost.toFixed(4)}`,
			);
		}
		console.log(`  r${round} ${task.id.padEnd(16)} ${cells.join("   ")}`);
	}
}

const control = summarize(cols.control ?? []);
const treatment = summarize(cols.treatment ?? []);
const perSolved = (summary) => (summary.solved === 0 ? "n/a" : (summary.cost / summary.solved).toFixed(4));
const pct = (before, after) => (before === 0 ? "n/a" : `${(((after - before) / before) * 100).toFixed(1)}%`);

console.log(`\n=== aggregate (${tasks.length} tasks x ${args.rounds} round(s)) ===`);
console.log("metric             | control    | treatment  | delta");
console.log("-------------------|------------|------------|-------");
console.log(`solved             | ${String(control.solved + "/" + control.runs).padEnd(10)} | ${String(treatment.solved + "/" + treatment.runs).padEnd(10)} | ${treatment.solved - control.solved}`);
console.log(`total tokens       | ${String(control.tokens).padEnd(10)} | ${String(treatment.tokens).padEnd(10)} | ${pct(control.tokens, treatment.tokens)}`);
console.log(`total cost (USD)   | ${control.cost.toFixed(4).padEnd(10)} | ${treatment.cost.toFixed(4).padEnd(10)} | ${pct(control.cost, treatment.cost)}`);
console.log(`cost per solved    | ${perSolved(control).padEnd(10)} | ${perSolved(treatment).padEnd(10)} |`);
console.log(`total wall (s)     | ${(control.wallMs / 1000).toFixed(0).padEnd(10)} | ${(treatment.wallMs / 1000).toFixed(0).padEnd(10)} | ${pct(control.wallMs, treatment.wallMs)}`);

const capabilityOk = treatment.solved >= control.solved - CAPABILITY_TOLERANCE;
const efficiencyOk = treatment.cost < control.cost;
console.log("\n=== gate (upstream methodology) ===");
console.log(`capability floor (solved >= control${CAPABILITY_TOLERANCE === 0 ? "" : " - " + CAPABILITY_TOLERANCE}): ${capabilityOk ? "PASS" : "FAIL"}`);
console.log(`efficiency (lower cost):             ${efficiencyOk ? "PASS" : "FAIL"}`);
console.log(`verdict: ${capabilityOk && efficiencyOk ? "ADMISSIBLE (efficiency win without capability loss)" : "REJECTED"}\n`);
