/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Runs one scenario against a local mock provider and reports deterministic
 * per-request metrics. `mode=control` loads no plugin; `mode=treatment` loads
 * the SoL-OpenCode plugin with the scenario's mechanism enabled.
 *
 * Usage: node run.mjs <scenario> <control|treatment>
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockProvider } from "./mock-provider.mjs";
import { scenarios } from "./scenarios.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, "../../packages/opencode");
const OPENCODE = process.env.OPENCODE_BIN ?? join(process.env.HOME ?? "", ".opencode/bin/opencode");

function isAuxRequest(body) {
	const system = (body.messages ?? []).find((message) => message.role === "system");
	const content = typeof system?.content === "string" ? system.content : "";
	return (
		content.toLowerCase().includes("title generator") || content.includes("lossless test/build output reducer")
	);
}

export function computeMetrics(requests) {
	const main = requests.filter((request) => !isAuxRequest(request.body));
	let totalPromptChars = 0;
	let totalToolChars = 0;
	let maxRequestChars = 0;
	for (const { body } of main) {
		const chars = JSON.stringify(body.messages ?? []).length;
		totalPromptChars += chars;
		maxRequestChars = Math.max(maxRequestChars, chars);
		for (const message of body.messages ?? []) {
			if (message.role === "tool" && typeof message.content === "string") totalToolChars += message.content.length;
		}
	}
	return {
		requests: main.length,
		auxRequests: requests.length - main.length,
		totalPromptChars,
		totalPromptTokens: Math.round(totalPromptChars / 4),
		totalToolChars,
		maxRequestChars,
	};
}

export async function runScenario(name, mode) {
	const scenario = scenarios[name];
	if (!scenario) throw new Error(`unknown scenario: ${name}`);
	const port = 4610 + Math.floor(Math.random() * 200);
	const runDir = join(tmpdir(), `sol-e2e-${name}-${mode}-${Date.now()}`);
	const project = join(runDir, "project");
	const home = join(runDir, "home");
	mkdirSync(project, { recursive: true });
	mkdirSync(home, { recursive: true });
	for (const [file, content] of Object.entries(scenario.setupFiles ?? {})) {
		writeFileSync(join(project, file), content);
	}

	const config = {
		$schema: "https://opencode.ai/config.json",
		provider: {
			mock: {
				npm: "@ai-sdk/openai-compatible",
				name: "Mock",
				options: { baseURL: `http://127.0.0.1:${port}/v1` },
				models: { [scenario.model]: { name: scenario.model } },
			},
		},
	};
	if (mode === "treatment") config.plugin = [[PLUGIN_DIR, scenario.plugin ?? {}]];
	writeFileSync(join(project, "opencode.json"), JSON.stringify(config, null, 2));

	const mock = await startMockProvider({
		port,
		log: join(runDir, "requests.jsonl"),
		model: scenario.model,
		script: scenario.script,
	});

	try {
		const env = {
			...process.env,
			OPENCODE_CONFIG: join(project, "opencode.json"),
			PWD: project,
			XDG_CONFIG_HOME: join(home, "config"),
			XDG_DATA_HOME: join(home, "data"),
			XDG_CACHE_HOME: join(home, "cache"),
		};
		delete env.OPENCODE;
		delete env.OPENCODE_PID;
		delete env.OLDPWD;
		const result = await new Promise((resolveRun) => {
			const child = spawn(
				OPENCODE,
				[
					"run",
					scenario.prompt,
					"-m",
					`mock/${scenario.model}`,
					"--print-logs",
					"--log-level",
					process.env.E2E_LOG_LEVEL ?? "ERROR",
					...(process.env.E2E_PURE === "1" ? ["--pure"] : []),
				],
				{ cwd: project, env, stdio: ["ignore", "pipe", "pipe"] },
			);
			let stdout = "";
			let stderr = "";
			const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
			child.stdout.on("data", (chunk) => (stdout += chunk));
			child.stderr.on("data", (chunk) => (stderr += chunk));
			child.on("close", (code) => {
				clearTimeout(timer);
				resolveRun({ code, stdout, stderr });
			});
		});
		return {
			scenario: name,
			mode,
			exitCode: result.code,
			metrics: computeMetrics(mock.requests),
			...(process.env.E2E_DEBUG === "1"
				? { debug: { project, configPath: join(project, "opencode.json"), config } }
				: {}),
			stdoutTail: result.stdout.slice(-600),
			stderrTail: result.stderr.slice(-6000),
		};
	} finally {
		await mock.close();
	}
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	const [name, mode = "control"] = process.argv.slice(2);
	const report = await runScenario(name, mode);
	console.log(JSON.stringify(report, null, 2));
}
