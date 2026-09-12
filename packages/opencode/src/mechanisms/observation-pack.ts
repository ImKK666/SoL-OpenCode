/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tool } from "@opencode-ai/plugin";
import {
	createLedger,
	createObservation,
	ensureStored,
	isObservationId,
	observationPath,
	placeholderFor,
	readRecallChunk,
	searchObservation,
	type Ledger,
	type SearchResult,
} from "@alicekk/sol-opencode-core";
import type {
	HookBus,
	MessageLike,
	MessagesTransformOutput,
	SolKernel,
	ToolAfterInput,
	ToolAfterOutput,
} from "../kernel.ts";

const RECALL_MAX_BYTES = 16 * 1024;
const RECALL_MAX_LINES = 400;
const MAX_QUERY_BYTES = 256;
const OWN_TOOLS = new Set(["obs_recall", "sol_trajectory"]);

interface ObservationMetadata {
	readonly id: string;
	readonly bytes: number;
	readonly lines: number;
	readonly tokens: number;
	readonly tool: string;
	readonly placeholder: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObservationMetadata(value: unknown): ObservationMetadata | undefined {
	if (!isRecord(value)) return undefined;
	const observation = value["observationPack"];
	if (!isRecord(observation)) return undefined;
	const { id, bytes, lines, tokens, tool: toolName, placeholder } = observation;
	if (typeof id !== "string" || !isObservationId(id)) return undefined;
	if (typeof bytes !== "number" || typeof lines !== "number" || typeof tokens !== "number") return undefined;
	if (typeof toolName !== "string" || typeof placeholder !== "string") return undefined;
	return { id, bytes, lines, tokens, tool: toolName, placeholder };
}

function countAssistantAfter(messages: readonly MessageLike[], index: number): number {
	let count = 0;
	for (let cursor = index + 1; cursor < messages.length; cursor++) {
		if (messages[cursor]?.info?.role === "assistant") count++;
	}
	return count;
}

function sessionIdOf(messages: readonly MessageLike[]): string | undefined {
	for (const message of messages) {
		const sessionID = message.info?.sessionID;
		if (typeof sessionID === "string" && sessionID.length > 0) return sessionID;
	}
	return undefined;
}

function formatSearch(result: SearchResult): string {
	if (result.matches.length === 0) {
		return `No matches (eof=${result.eof}, next_offset=${result.nextOffset}).`;
	}
	const body = result.matches.map((match) => `#${match.line} @${match.byteOffset}: ${match.context}`).join("\n---\n");
	return `${body}\n[next_offset=${result.nextOffset} eof=${result.eof}]`;
}

/**
 * ObservationPack — archive large tool results and recall them by handle.
 *
 * `tool.execute.after` archives the full text (preferring OpenCode's
 * `metadata.outputPath`) and stamps a deterministic placeholder on the part's
 * metadata. `experimental.chat.messages.transform` swaps the visible output for
 * the placeholder once the grace period of full sends has elapsed. `obs_recall`
 * pages or literal-searches the archive.
 */
export function registerObservationPack(kernel: SolKernel, bus: HookBus): void {
	const { thresholdBytes, fullSends } = kernel.config.observationPack;
	const ledgers = new Map<string, Ledger>();

	const ledgerFor = (sessionID: string): Ledger => {
		let ledger = ledgers.get(sessionID);
		if (ledger === undefined) {
			ledger = createLedger(join(kernel.sessionRoot(sessionID), "observation-pack", "ledger.jsonl"));
			ledgers.set(sessionID, ledger);
		}
		return ledger;
	};

	bus.onToolAfter(async (input: ToolAfterInput, output: ToolAfterOutput): Promise<void> => {
		if (input.tool === undefined || input.sessionID === undefined) return;
		if (kernel.isAuxSession(input.sessionID) || OWN_TOOLS.has(input.tool)) return;
		const text = typeof output.output === "string" ? output.output : undefined;
		if (text === undefined) return;

		const metadata = isRecord(output.metadata) ? output.metadata : {};
		const outputPath = typeof metadata["outputPath"] === "string" ? metadata["outputPath"] : undefined;
		let body = text;
		if (outputPath !== undefined) {
			try {
				body = await readFile(outputPath, "utf8");
			} catch {
				body = text;
			}
		}

		const observation = createObservation(
			{ toolName: input.tool, toolCallId: input.callID ?? "", text: body },
			kernel.sessionRoot(input.sessionID),
			thresholdBytes,
		);
		if (observation === undefined) return;
		await ensureStored(observation);
		output.metadata = {
			...metadata,
			observationPack: {
				id: observation.id,
				bytes: observation.bytes,
				lines: observation.lines,
				tokens: observation.tokens,
				tool: observation.toolName,
				placeholder: placeholderFor(observation),
			},
		};
	});

	bus.onMessagesTransform((_input: unknown, output: MessagesTransformOutput): void => {
		const messages = output.messages;
		if (!Array.isArray(messages) || messages.length === 0) return;
		const sessionID = sessionIdOf(messages);
		if (sessionID !== undefined && kernel.isAuxSession(sessionID)) return;

		for (let index = 0; index < messages.length; index++) {
			const parts = messages[index]?.parts;
			if (!Array.isArray(parts)) continue;
			if (countAssistantAfter(messages, index) < fullSends) continue;
			for (const part of parts) {
				if (!isRecord(part) || part["type"] !== "tool") continue;
				const state = part["state"];
				if (!isRecord(state) || state["status"] !== "completed") continue;
				const observation = readObservationMetadata(state["metadata"]);
				if (observation === undefined) continue;
				if (state["output"] === observation.placeholder) continue;
				state["output"] = observation.placeholder;
				if (sessionID !== undefined) {
					void ledgerFor(sessionID)({
						event: "placeholder",
						id: observation.id,
						bytes: observation.bytes,
						tokens: observation.tokens,
					});
				}
			}
		}
	});

	bus.registerTool(
		"obs_recall",
		tool({
			description:
				"Recall an archived large tool result. Pass {id, offset} to page through it, or {id, query} for a case-sensitive literal byte search.",
			args: {
				id: tool.schema.string(),
				offset: tool.schema.number().optional(),
				query: tool.schema.string().optional(),
			},
			async execute(args, context) {
				if (!isObservationId(args.id)) return "Invalid observation id.";
				const sessionID = context.sessionID;
				const path = observationPath(kernel.sessionRoot(sessionID), args.id);
				const ledger = ledgerFor(sessionID);
				const query = typeof args.query === "string" && args.query.length > 0 ? args.query : undefined;
				const offset =
					typeof args.offset === "number" && Number.isSafeInteger(args.offset) && args.offset >= 0
						? args.offset
						: 0;

				try {
					if (query !== undefined) {
						const bytes = Buffer.from(query, "utf8");
						if (bytes.length > MAX_QUERY_BYTES) {
							return `Query must be at most ${MAX_QUERY_BYTES} UTF-8 bytes.`;
						}
						const result = await searchObservation(path, bytes, offset, RECALL_MAX_BYTES, context.abort);
						void ledger({
							event: "search",
							id: args.id,
							offset,
							matches: result.matches.length,
							eof: result.eof,
						});
						return formatSearch(result);
					}
					const chunk = await readRecallChunk(path, offset, {
						maxBytes: RECALL_MAX_BYTES,
						maxLines: RECALL_MAX_LINES,
					});
					void ledger({ event: "recall", id: args.id, offset, nextOffset: chunk.nextOffset, eof: chunk.eof });
					return `${chunk.text}\n[next_offset=${chunk.nextOffset} eof=${chunk.eof}]`;
				} catch (error) {
					return `obs_recall failed: ${error instanceof Error ? error.message : String(error)}`;
				}
			},
		}),
	);
}
