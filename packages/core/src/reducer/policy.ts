/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
	DIAGNOSTIC_COMMAND,
	LIKELY_SECRET,
	REDUCER_RECEIPT_SCHEMA,
	type ReducerConfig,
	sha256,
} from "./config.ts";
import { reducerInstructions } from "./receipt.ts";

/**
 * Why a diagnostic tool result was or was not eligible for reduction.
 *
 * `not-diagnostic` and `below-min-bytes` are silent skips (SoL-Pi did not
 * journal them); the other reasons are fallback events the adapter records.
 */
export type ReducerGateReason =
	| "not-diagnostic"
	| "below-min-bytes"
	| "source-over-max-chars"
	| "likely-secret";

export type ReducerGateResult =
	| { readonly eligible: true }
	| { readonly eligible: false; readonly reason: ReducerGateReason };

export function evaluateReducerGates(command: string, body: string, config: ReducerConfig): ReducerGateResult {
	if (!DIAGNOSTIC_COMMAND.test(command)) return { eligible: false, reason: "not-diagnostic" };
	if (Buffer.byteLength(body, "utf8") < config.minBytes) return { eligible: false, reason: "below-min-bytes" };
	if (body.length > config.maxChars) return { eligible: false, reason: "source-over-max-chars" };
	if (LIKELY_SECRET.test(body)) return { eligible: false, reason: "likely-secret" };
	return { eligible: true };
}

/**
 * Cache key for an accepted receipt. Every input that could change the receipt
 * (archive identity, command, exit state, reducer model, schema and
 * instructions) participates, so a hit is safe to reuse verbatim.
 */
export function reducerCacheKey(
	config: ReducerConfig,
	archiveHash: string,
	command: string,
	isError: boolean,
): string {
	return sha256(
		JSON.stringify([
			config.storeRoot,
			archiveHash,
			command,
			isError,
			config.reducerProvider,
			config.reducerModel,
			config.maxOutputTokens,
			REDUCER_RECEIPT_SCHEMA,
			reducerInstructions(),
		]),
	);
}
