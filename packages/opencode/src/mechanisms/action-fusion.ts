/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
	THEN_RUN_FAILED,
	THEN_RUN_SKIPPED,
	THEN_RUN_SUCCEEDED,
	resolveToolPath,
	runThenRun,
	type ThenRunInput,
} from "@alicekk/sol-opencode-core";
import type {
	HookBus,
	SolKernel,
	ToolAfterInput,
	ToolAfterOutput,
	ToolBeforeInput,
	ToolBeforeOutput,
	ToolDefinitionInput,
	ToolDefinitionOutput,
} from "../kernel.ts";

const FILE_PATH_ARG = "filePath";
const THEN_RUN_ARG = "then_run";

const THEN_RUN_PROPERTY = {
	type: "object",
	properties: {
		command: { type: "string", description: "Bash command to run after a successful mutation" },
		timeout: { type: "number", description: "Timeout in seconds (optional; no default timeout)" },
	},
	required: ["command"],
	additionalProperties: false,
	description: "Optional follow-up command run in the same call after this mutation succeeds.",
} as const;

// Built-in OpenCode tool schemas, pinned to opencode 1.18.30. The `tool.definition`
// hook can only practically inject through `jsonSchema`: built-in `parameters`
// are Effect Schemas, while `jsonSchema` (normally undefined) is what
// `ToolJsonSchema.fromTool` prefers once set (see opencode
// packages/opencode/src/tool/registry.ts and tool/json-schema.ts).
const INJECTABLE_SCHEMAS: Record<string, Record<string, unknown>> = {
	edit: {
		type: "object",
		properties: {
			filePath: { type: "string", description: "The absolute path to the file to modify" },
			oldString: { type: "string", description: "The text to replace" },
			newString: {
				type: "string",
				description: "The text to replace it with (must be different from oldString)",
			},
			replaceAll: { type: "boolean", description: "Replace all occurrences of oldString (default false)" },
			[THEN_RUN_ARG]: THEN_RUN_PROPERTY,
		},
		required: ["filePath", "oldString", "newString"],
		additionalProperties: true,
	},
	write: {
		type: "object",
		properties: {
			filePath: {
				type: "string",
				description: "The absolute path to the file to write (must be absolute, not relative)",
			},
			content: { type: "string", description: "The content to write to the file" },
			[THEN_RUN_ARG]: THEN_RUN_PROPERTY,
		},
		required: ["filePath", "content"],
		additionalProperties: true,
	},
};

const FUSION_SENTENCE =
	"This tool also accepts an optional `then_run` object ({command, timeout?}). When present, the command runs immediately after a successful mutation in the same call and one combined result is returned.";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeThenRun(value: unknown): ThenRunInput | undefined {
	if (!isRecord(value) || typeof value.command !== "string" || value.command.length === 0) return undefined;
	const timeout =
		typeof value.timeout === "number" && Number.isFinite(value.timeout) && value.timeout > 0
			? value.timeout
			: undefined;
	return timeout === undefined ? { command: value.command } : { command: value.command, timeout };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`command timed out after ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

// NOTE: BunShell exposes no abort/kill handle, so a timed-out command is
// reported as failed but its process may linger (DESIGN §11 spike #2).
async function runShell(kernel: SolKernel, thenRun: ThenRunInput): Promise<string> {
	const shell = kernel.input.$;
	const promise = shell`${{ raw: thenRun.command }}`.cwd(kernel.input.directory).nothrow().quiet();
	const result = thenRun.timeout === undefined ? await promise : await withTimeout(promise, thenRun.timeout * 1000);
	const stdout = result.stdout.toString("utf8");
	const stderr = result.stderr.toString("utf8");
	const combined = [stdout, stderr].filter((part) => part.length > 0).join("\n");
	if (result.exitCode !== 0) {
		throw new Error(`command exited with code ${result.exitCode}${combined.length > 0 ? `\n${combined}` : ""}`);
	}
	return combined;
}

/**
 * Action Fusion — let an edit/write carry its follow-up validation command.
 *
 * `tool.definition` injects `then_run` into the model-facing schema;
 * `tool.execute.before` stashes it and strips it (in place, so the built-in
 * schema never rejects it); `tool.execute.after` runs the command under the
 * core per-file queue and appends a marker to the same result.
 */
export function registerActionFusion(kernel: SolKernel, bus: HookBus): void {
	const toolSet = new Set(kernel.config.actionFusion.tools);
	const pending = new Map<string, { readonly thenRun: ThenRunInput; readonly absolutePath: string }>();

	bus.onToolDefinition((input: ToolDefinitionInput, output: ToolDefinitionOutput): void => {
		if (input.toolID === undefined || !toolSet.has(input.toolID)) return;
		const schema = INJECTABLE_SCHEMAS[input.toolID];
		if (schema === undefined) return;
		output.jsonSchema = schema;
		output.description = `${output.description ?? ""}\n\n${FUSION_SENTENCE}`.trim();
	});

	bus.onToolBefore((input: ToolBeforeInput, output: ToolBeforeOutput): void => {
		if (input.tool === undefined || !toolSet.has(input.tool)) return;
		const args = output.args;
		if (!isRecord(args)) return;
		const thenRun = normalizeThenRun(args[THEN_RUN_ARG]);
		const filePath = typeof args[FILE_PATH_ARG] === "string" ? args[FILE_PATH_ARG] : undefined;
		// Verified: `args` is the same reference `execute()` receives, so an
		// in-place delete propagates and the built-in never sees then_run.
		delete args[THEN_RUN_ARG];
		if (thenRun === undefined || filePath === undefined || input.callID === undefined) return;
		pending.set(input.callID, {
			thenRun,
			absolutePath: resolveToolPath(kernel.input.directory, filePath),
		});
	});

	bus.onToolAfter(async (input: ToolAfterInput, output: ToolAfterOutput): Promise<void> => {
		if (input.callID === undefined) return;
		const entry = pending.get(input.callID);
		if (entry === undefined) return;
		pending.delete(input.callID);
		const outcome = await runThenRun({
			absolutePath: entry.absolutePath,
			thenRun: entry.thenRun,
			runCommand: (thenRun) => runShell(kernel, thenRun),
		});
		const marker =
			outcome.status === "succeeded"
				? `${THEN_RUN_SUCCEEDED}\n${outcome.output}`
				: outcome.status === "failed"
					? `${THEN_RUN_FAILED}\n${outcome.error}`
					: `${THEN_RUN_SKIPPED} ${outcome.reason}`;
		output.output = `${output.output ?? ""}${output.output ? "\n\n" : ""}${marker}`;
		output.metadata = {
			...(isRecord(output.metadata) ? output.metadata : {}),
			actionFusion: { status: outcome.status },
		};
	});
}
