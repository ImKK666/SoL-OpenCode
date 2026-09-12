/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	DIAGNOSTIC_COMMAND,
	REDUCER_RECEIPT_SCHEMA,
	ReceiptCache,
	archiveBody,
	archiveRoot,
	createLedger,
	evaluateReducerGates,
	loadReducerConfig,
	receiptText,
	reducerCacheKey,
	sha256,
	validateReceipt,
	type Ledger,
	type ReducerConfig,
	type ReducerModelResult,
} from "@alicekk/sol-opencode-core";
import type { HookBus, SolKernel, ToolAfterInput, ToolAfterOutput } from "../kernel.ts";
import { callReducerModel } from "./reducer-transport.ts";

interface ReducerState {
	readonly config: ReducerConfig;
	readonly ledger: Ledger;
	readonly cache: ReceiptCache;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Evidence-Preserving Reducer — replace a long diagnostic log with a verified
 * receipt, over a child-session model call.
 *
 * The original log is archived first; a receipt is applied only when every
 * quoted line appears byte-for-byte in the archive and the status matches the
 * observed exit code. Any failure path leaves the original output untouched.
 *
 * Registered before ObservationPack so receipts (now small) never get packed.
 */
export function registerReducer(kernel: SolKernel, bus: HookBus): void {
	const { provider, model } = kernel.config.evidencePreservingReducer;
	const states = new Map<string, ReducerState>();

	const stateFor = (sessionID: string): ReducerState => {
		let state = states.get(sessionID);
		if (state === undefined) {
			const runtimeDirectory = kernel.sessionRoot(sessionID);
			const config = loadReducerConfig(runtimeDirectory, {
				...(provider === undefined ? {} : { reducerProvider: provider }),
				...(model === undefined ? {} : { reducerModel: model }),
			});
			state = {
				config,
				ledger: createLedger(join(runtimeDirectory, "evidence-preserving-reducer", "journal.jsonl")),
				cache: new ReceiptCache(64),
			};
			states.set(sessionID, state);
		}
		return state;
	};

	bus.onToolAfter(async (input: ToolAfterInput, output: ToolAfterOutput): Promise<void> => {
		if (input.tool !== "bash" || input.sessionID === undefined) return;
		if (kernel.isAuxSession(input.sessionID)) return;
		const args = input.args;
		const command = isRecord(args) && typeof args.command === "string" ? args.command : undefined;
		if (command === undefined || !DIAGNOSTIC_COMMAND.test(command)) return;

		const metadata = isRecord(output.metadata) ? output.metadata : {};
		const exit = typeof metadata["exit"] === "number" ? metadata["exit"] : 0;
		const isError = exit !== 0;
		const outputText = typeof output.output === "string" ? output.output : "";
		const outputPath = typeof metadata["outputPath"] === "string" ? metadata["outputPath"] : undefined;
		let body = outputText;
		if (outputPath !== undefined) {
			try {
				body = await readFile(outputPath, "utf8");
			} catch {
				body = outputText;
			}
		}

		const state = stateFor(input.sessionID);
		const gate = evaluateReducerGates(command, body, state.config);
		if (!gate.eligible) {
			if (gate.reason === "source-over-max-chars" || gate.reason === "likely-secret") {
				void state.ledger({ event: "fallback", reason: gate.reason });
			}
			return;
		}

		const archive = await archiveBody(archiveRoot(state.config), body);
		void state.ledger({
			event: "candidate",
			toolCallId: input.callID,
			commandSha256: sha256(command),
			isError,
			sourceSha256: archive.hash,
			sourceBytes: archive.bytes,
			sourceLines: archive.lines,
			sourcePath: archive.path,
		});

		const cacheKey = reducerCacheKey(state.config, archive.hash, command, isError);
		const cached = state.cache.get(cacheKey);
		let result: ReducerModelResult;
		try {
			result =
				cached ??
				(await callReducerModel({
					client: kernel.input.client,
					directory: kernel.input.directory,
					parentSessionID: input.sessionID,
					provider: state.config.reducerProvider,
					model: state.config.reducerModel,
					timeoutMs: state.config.timeoutMs,
					command,
					isError,
					archive,
					body,
				}));
		} catch (error) {
			void state.ledger({
				event: "fallback",
				toolCallId: input.callID,
				sourceSha256: archive.hash,
				reason:
					error instanceof Error && error.name === "AbortError" ? "model-call-timeout" : "model-call-exception",
			});
			return;
		}

		if (!result.ok) {
			void state.ledger({
				event: "fallback",
				toolCallId: input.callID,
				sourceSha256: archive.hash,
				reason: "model-response-error",
			});
			return;
		}

		const checked = validateReceipt(result.outputText, archive, body, isError);
		if (!checked.ok) {
			state.cache.delete(cacheKey);
			void state.ledger({
				event: "fallback",
				toolCallId: input.callID,
				sourceSha256: archive.hash,
				reason: checked.reason,
			});
			return;
		}

		const receipt = receiptText(command, archive, checked.value, result);
		const receiptBytes = Buffer.byteLength(receipt, "utf8");
		if (receiptBytes >= archive.bytes) {
			state.cache.delete(cacheKey);
			void state.ledger({
				event: "fallback",
				toolCallId: input.callID,
				sourceSha256: archive.hash,
				reason: "receipt-not-smaller",
			});
			return;
		}

		if (cached === undefined) state.cache.set(cacheKey, result);
		void state.ledger({
			event: "applied",
			toolCallId: input.callID,
			commandSha256: sha256(command),
			sourceSha256: archive.hash,
			sourceBytes: archive.bytes,
			receiptBytes,
			evidenceCount: checked.value.evidence.length,
			uncertain: checked.value.uncertain,
			cacheHit: cached !== undefined,
		});
		output.output = receipt;
		output.metadata = {
			...metadata,
			evidencePreservingReducer: {
				schema: REDUCER_RECEIPT_SCHEMA,
				sourceSha256: archive.hash,
				sourceBytes: archive.bytes,
				receiptBytes,
				evidenceCount: checked.value.evidence.length,
				uncertain: checked.value.uncertain,
			},
		};
	});
}
