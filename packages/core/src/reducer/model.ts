/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

/**
 * Harness-neutral result of an auxiliary reducer-model call.
 *
 * Adapters produce this from whatever model transport the harness offers; core
 * only needs the fields the receipt pipeline reads.
 */
export interface NormalizedUsage {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly totalTokens: number;
}

export interface ReducerModelResult {
	readonly errorMessage: string | undefined;
	readonly model: string;
	readonly ok: boolean;
	readonly outputText: string;
	readonly provider: string;
	readonly stopReason: string;
	readonly usage: NormalizedUsage;
}
