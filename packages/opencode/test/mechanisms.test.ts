/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import {
	REDUCER_RECEIPT_PREFIX,
	REDUCER_RECEIPT_SCHEMA,
	observationPath,
	sha256,
} from "@alicekk/sol-opencode-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SolOpenCodePlugin } from "../src/index.ts";
import { projectSlug } from "../src/storage.ts";

interface ClientCalls {
	create: number;
	prompt: number;
	delete: number;
	summarize: number;
}

function makeClient(responseText: string): { client: PluginInput["client"]; calls: ClientCalls } {
	const calls: ClientCalls = { create: 0, prompt: 0, delete: 0, summarize: 0 };
	const client = {
		session: {
			create: async () => {
				calls.create += 1;
				return { data: { id: "child-1" } };
			},
			prompt: async () => {
				calls.prompt += 1;
				return {
					data: {
						info: {
							providerID: "p",
							modelID: "m",
							finish: "stop",
							tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } },
						},
						parts: [{ type: "text", text: responseText }],
					},
				};
			},
			delete: async () => {
				calls.delete += 1;
				return { data: true };
			},
			summarize: async () => {
				calls.summarize += 1;
				return { data: true };
			},
		},
	} as unknown as PluginInput["client"];
	return { client, calls };
}

function fakeShell(stdout: string, exitCode: number): PluginInput["$"] {
	const promise = Promise.resolve({
		stdout: Buffer.from(stdout, "utf8"),
		stderr: Buffer.alloc(0),
		exitCode,
		text: () => stdout,
		json: () => ({}),
		arrayBuffer: () => new ArrayBuffer(0),
		bytes: () => new Uint8Array(),
		blob: () => new Blob([]),
	});
	const chain: Record<string, unknown> = {};
	Object.assign(chain, {
		cwd: () => chain,
		env: () => chain,
		quiet: () => chain,
		nothrow: () => chain,
		throws: () => chain,
		lines: async function* () {},
		text: () => promise.then((output) => output.stdout.toString("utf8")),
		json: () => promise.then(() => ({})),
		then: promise.then.bind(promise),
		catch: promise.catch.bind(promise),
		finally: promise.finally.bind(promise),
	});
	return ((_strings: TemplateStringsArray, ..._expressions: unknown[]) => chain) as unknown as PluginInput["$"];
}

function fakeInput(directory: string, client: PluginInput["client"], shell: PluginInput["$"]): PluginInput {
	return {
		client,
		directory,
		worktree: directory,
		project: {} as PluginInput["project"],
		serverUrl: new URL("http://localhost:4096"),
		$: shell,
	} as unknown as PluginInput;
}

function hooksOf(hooks: unknown): Record<string, unknown> {
	return hooks as Record<string, unknown>;
}

function call(hooks: Record<string, unknown>, name: string): (...args: unknown[]) => Promise<void> {
	return hooks[name] as (...args: unknown[]) => Promise<void>;
}

function toolMap(
	hooks: Record<string, unknown>,
): Record<string, { execute: (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<string> }> {
	return hooks["tool"] as Record<
		string,
		{ execute: (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<string> }
	>;
}

let dataHome = "";

beforeEach(async () => {
	dataHome = await mkdtemp(join(tmpdir(), "sol-e2e-"));
	process.env["SOL_OPENCODE_HOME"] = dataHome;
});

afterEach(async () => {
	delete process.env["SOL_OPENCODE_HOME"];
	await rm(dataHome, { recursive: true, force: true });
});

describe("Action Fusion end-to-end", () => {
	it("injects then_run, strips it in place, and appends the command result", async () => {
		const { client } = makeClient("");
		const hooks = hooksOf(
			await SolOpenCodePlugin(fakeInput(dataHome, client, fakeShell("37 passed\n", 0)), {
				actionFusion: { enabled: true },
			}),
		);

		const definition: Record<string, unknown> = { description: "Edit", parameters: {} };
		await call(hooks, "tool.definition")({ toolID: "edit" }, definition);
		const jsonSchema = definition["jsonSchema"] as { properties: Record<string, unknown> };
		expect(jsonSchema.properties["then_run"]).toBeDefined();
		expect(String(definition["description"])).toContain("then_run");

		const file = join(dataHome, "a.ts");
		await writeFile(file, "export const a = 1\n", "utf8");
		const args: Record<string, unknown> = {
			filePath: file,
			oldString: "1",
			newString: "2",
			then_run: { command: "npm test" },
		};
		await call(hooks, "tool.execute.before")({ tool: "edit", sessionID: "s1", callID: "c1" }, { args });
		expect(args["then_run"]).toBeUndefined();

		const output: Record<string, unknown> = { output: "edited", metadata: {} };
		await call(hooks, "tool.execute.after")(
			{ tool: "edit", sessionID: "s1", callID: "c1", args },
			output,
		);
		expect(String(output["output"])).toContain("[then_run:succeeded]");
		expect(String(output["output"])).toContain("37 passed");
	});

	it("reports a failed command without failing the mutation", async () => {
		const { client } = makeClient("");
		const hooks = hooksOf(
			await SolOpenCodePlugin(fakeInput(dataHome, client, fakeShell("boom\n", 1)), {
				actionFusion: { enabled: true },
			}),
		);
		const file = join(dataHome, "b.ts");
		await writeFile(file, "x\n", "utf8");
		const args: Record<string, unknown> = { filePath: file, then_run: { command: "npm test" } };
		await call(hooks, "tool.execute.before")({ tool: "write", sessionID: "s1", callID: "c2" }, { args });
		const output: Record<string, unknown> = { output: "written", metadata: {} };
		await call(hooks, "tool.execute.after")({ tool: "write", sessionID: "s1", callID: "c2", args }, output);
		expect(String(output["output"])).toContain("[then_run:failed]");
		expect(String(output["output"])).toContain("boom");
	});
});

describe("ObservationPack end-to-end", () => {
	it("archives the full output, projects a placeholder after the grace period, and recalls it", async () => {
		const { client } = makeClient("");
		const hooks = hooksOf(
			await SolOpenCodePlugin(fakeInput(dataHome, client, fakeShell("", 0)), {
				observationPack: { enabled: true, thresholdBytes: 10_240, fullSends: 2 },
			}),
		);

		const body = Array.from({ length: 500 }, (_value, index) => `line ${index} ${"y".repeat(30)}\n`).join("");
		const outputPath = join(dataHome, "full.txt");
		await writeFile(outputPath, body, "utf8");
		const output: Record<string, unknown> = { output: body.slice(0, 200), metadata: { outputPath } };
		await call(hooks, "tool.execute.after")({ tool: "bash", sessionID: "s1", callID: "c1" }, output);

		const metadata = output["metadata"] as Record<string, unknown>;
		const observation = metadata["observationPack"] as Record<string, unknown>;
		const id = String(observation["id"]);
		expect(id.startsWith("obs_")).toBe(true);
		expect(await readFile(observationPath(join(dataHome, projectSlug(dataHome), "s1"), id), "utf8")).toBe(body);

		const state = { status: "completed", output: body, metadata };
		const toolPart = { type: "tool", callID: "c1", tool: "bash", state };
		const messages = [
			{ info: { role: "assistant", sessionID: "s1" }, parts: [toolPart] },
			{ info: { role: "assistant" }, parts: [] },
			{ info: { role: "assistant" }, parts: [] },
		];
		await call(hooks, "experimental.chat.messages.transform")({}, { messages });
		expect(state.output).toBe(String(observation["placeholder"]));

		const recalled = await toolMap(hooks)["obs_recall"]?.execute(
			{ id, offset: 0 },
			{ sessionID: "s1", abort: undefined },
		);
		expect(String(recalled)).toContain("line 0 ");
	});
});

describe("Evidence-Preserving Reducer end-to-end", () => {
	it("applies a verified receipt", async () => {
		const body = `error: kaboom\n${"x".repeat(6_000)}`;
		const receipt = JSON.stringify({
			schema: REDUCER_RECEIPT_SCHEMA,
			source_sha256: sha256(body),
			status: "failure",
			uncertain: false,
			evidence: [{ kind: "failure", quote: "error: kaboom" }],
		});
		const { client, calls } = makeClient(receipt);
		const hooks = hooksOf(
			await SolOpenCodePlugin(fakeInput(dataHome, client, fakeShell("", 0)), {
				evidencePreservingReducer: { enabled: true },
			}),
		);
		const output: Record<string, unknown> = { output: body, metadata: { exit: 1 } };
		await call(hooks, "tool.execute.after")(
			{ tool: "bash", sessionID: "s1", callID: "c1", args: { command: "cargo build" } },
			output,
		);
		expect(String(output["output"]).startsWith(REDUCER_RECEIPT_PREFIX)).toBe(true);
		expect(calls.create).toBe(1);
		expect(calls.delete).toBe(1);
	});

	it("leaves the original in place when a quote cannot be verified", async () => {
		const body = `error: kaboom\n${"x".repeat(6_000)}`;
		const receipt = JSON.stringify({
			schema: REDUCER_RECEIPT_SCHEMA,
			source_sha256: sha256(body),
			status: "failure",
			uncertain: false,
			evidence: [{ kind: "failure", quote: "not present in the log" }],
		});
		const { client } = makeClient(receipt);
		const hooks = hooksOf(
			await SolOpenCodePlugin(fakeInput(dataHome, client, fakeShell("", 0)), {
				evidencePreservingReducer: { enabled: true },
			}),
		);
		const output: Record<string, unknown> = { output: body, metadata: { exit: 1 } };
		await call(hooks, "tool.execute.after")(
			{ tool: "bash", sessionID: "s2", callID: "c2", args: { command: "cargo build" } },
			output,
		);
		expect(output["output"]).toBe(body);
	});
});

describe("Online Context Compact end-to-end", () => {
	it("adds boundary instructions and does not summarize without a completed boundary", async () => {
		const { client, calls } = makeClient("");
		const hooks = hooksOf(
			await SolOpenCodePlugin(fakeInput(dataHome, client, fakeShell("", 0)), {
				onlineContextCompact: { enabled: true },
			}),
		);
		const compacting: Record<string, unknown> = { context: ["existing"] };
		await call(hooks, "experimental.session.compacting")({ sessionID: "s1" }, compacting);
		const context = compacting["context"] as string[];
		expect(context).toHaveLength(2);
		expect(context[1]).toContain("Preserve completed work");

		await call(hooks, "event")({ type: "session.idle", properties: { sessionID: "s1" } });
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
		expect(calls.summarize).toBe(0);
	});
});
