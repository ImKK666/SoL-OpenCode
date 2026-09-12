/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import type { PluginInput } from "@opencode-ai/plugin";
import {
	reducerInput,
	reducerInstructions,
	type ArchiveObject,
	type NormalizedUsage,
	type ReducerModelResult,
} from "@alicekk/sol-opencode-core";

interface PromptPart {
	readonly type?: string;
	readonly text?: unknown;
}

interface AssistantInfo {
	readonly providerID?: string;
	readonly modelID?: string;
	readonly finish?: string;
	readonly error?: unknown;
	readonly tokens?: {
		readonly input?: number;
		readonly output?: number;
		readonly cache?: { readonly read?: number; readonly write?: number };
	};
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
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

function textFromParts(parts: readonly PromptPart[]): string {
	return parts
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("");
}

function usageFrom(info: AssistantInfo): NormalizedUsage {
	const input = typeof info.tokens?.input === "number" ? info.tokens.input : 0;
	const output = typeof info.tokens?.output === "number" ? info.tokens.output : 0;
	return {
		input,
		output,
		cacheRead: typeof info.tokens?.cache?.read === "number" ? info.tokens.cache.read : 0,
		cacheWrite: typeof info.tokens?.cache?.write === "number" ? info.tokens.cache.write : 0,
		totalTokens: input + output,
	};
}

export interface ReducerTransportInput {
	readonly client: PluginInput["client"];
	readonly directory: string;
	readonly parentSessionID: string;
	readonly provider: string;
	readonly model: string;
	readonly timeoutMs: number;
	readonly command: string;
	readonly isError: boolean;
	readonly archive: ArchiveObject;
	readonly body: string;
}

/**
 * Auxiliary reducer-model call over a child session.
 *
 * Credentials stay entirely with OpenCode; only verified SDK methods are used
 * (`session.create`, `session.prompt`, `session.delete`). Tool use is disabled
 * and the reducer system prompt is passed inline, and receipt validation is the
 * safety net if the child still misbehaves.
 */
export async function callReducerModel(input: ReducerTransportInput): Promise<ReducerModelResult> {
	const { client, directory } = input;
	const created = await client.session.create({
		body: { parentID: input.parentSessionID, title: "sol-reducer" },
		query: { directory },
	});
	const childID = created.data?.id;
	if (typeof childID !== "string" || childID.length === 0) {
		throw new Error("reducer child session creation returned no id");
	}

	try {
		const pending = client.session.prompt({
			path: { id: childID },
			query: { directory },
			body: {
				system: reducerInstructions(),
				tools: {},
				model: { providerID: input.provider, modelID: input.model },
				parts: [{ type: "text", text: reducerInput(input.command, input.isError, input.archive, input.body) }],
			},
		});
		const result = await withTimeout(pending, input.timeoutMs, "reducer model call");
		const info = result.data?.info as AssistantInfo | undefined;
		if (info === undefined) throw new Error("reducer prompt returned no message");
		return {
			errorMessage: info.error === undefined ? undefined : String(info.error),
			model: typeof info.modelID === "string" ? info.modelID : input.model,
			ok: info.error === undefined,
			outputText: textFromParts(result.data?.parts ?? []),
			provider: typeof info.providerID === "string" ? info.providerID : input.provider,
			stopReason: typeof info.finish === "string" ? info.finish : info.error === undefined ? "stop" : "error",
			usage: usageFrom(info),
		};
	} finally {
		await client.session.delete({ path: { id: childID }, query: { directory } }).catch(() => undefined);
	}
}
