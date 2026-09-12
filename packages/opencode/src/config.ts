/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

// Plugin configuration is supplied through OpenCode's plugin options tuple:
//   "plugin": [["@alicekk/sol-opencode", { "trajectoryInspector": { "enabled": true } }]]
// Every mechanism is opt-in; a missing key leaves it disabled.

export interface TrajectoryInspectorConfig {
	readonly enabled: boolean;
	readonly maxRecords: number;
}

export interface ActionFusionConfig {
	readonly enabled: boolean;
	readonly tools: readonly string[];
}

export interface ObservationPackConfig {
	readonly enabled: boolean;
	readonly thresholdBytes: number;
	readonly fullSends: number;
}

export interface EvidencePreservingReducerConfig {
	readonly enabled: boolean;
	readonly provider?: string;
	readonly model?: string;
}

export interface OnlineContextCompactConfig {
	readonly enabled: boolean;
	readonly cacheWriteReadRatio: number;
	readonly keepRecentTokens: number;
	readonly maxAutoContinuations: number;
}

export interface SolConfig {
	readonly trajectoryInspector: TrajectoryInspectorConfig;
	readonly actionFusion: ActionFusionConfig;
	readonly observationPack: ObservationPackConfig;
	readonly evidencePreservingReducer: EvidencePreservingReducerConfig;
	readonly onlineContextCompact: OnlineContextCompactConfig;
}

const DEFAULT_MAX_RECORDS = 12;
const DEFAULT_FUSION_TOOLS = ["edit", "write"] as const;
const DEFAULT_OBSERVATION_THRESHOLD_BYTES = 10 * 1024;
const DEFAULT_FULL_SENDS = 2;
const DEFAULT_CACHE_WRITE_READ_RATIO = 12.5;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const DEFAULT_MAX_AUTO_CONTINUATIONS = 3;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function readPositiveInt(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function readPositiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readStringArray(value: unknown, fallback: readonly string[]): readonly string[] {
	if (!Array.isArray(value)) return fallback;
	const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
	return items.length > 0 ? items : fallback;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseConfig(options: unknown): SolConfig {
	const root = isRecord(options) ? options : {};
	const trajectory = isRecord(root.trajectoryInspector) ? root.trajectoryInspector : {};
	const fusion = isRecord(root.actionFusion) ? root.actionFusion : {};
	const observation = isRecord(root.observationPack) ? root.observationPack : {};
	const reducer = isRecord(root.evidencePreservingReducer) ? root.evidencePreservingReducer : {};
	const compact = isRecord(root.onlineContextCompact) ? root.onlineContextCompact : {};

	return {
		trajectoryInspector: {
			enabled: readBoolean(trajectory.enabled),
			maxRecords: readPositiveInt(trajectory.maxRecords, DEFAULT_MAX_RECORDS),
		},
		actionFusion: {
			enabled: readBoolean(fusion.enabled),
			tools: readStringArray(fusion.tools, DEFAULT_FUSION_TOOLS),
		},
		observationPack: {
			enabled: readBoolean(observation.enabled),
			thresholdBytes: readPositiveInt(observation.thresholdBytes, DEFAULT_OBSERVATION_THRESHOLD_BYTES),
			fullSends: readPositiveInt(observation.fullSends, DEFAULT_FULL_SENDS),
		},
		evidencePreservingReducer: {
			enabled: readBoolean(reducer.enabled),
			provider: readOptionalString(reducer.provider),
			model: readOptionalString(reducer.model),
		},
		onlineContextCompact: {
			enabled: readBoolean(compact.enabled),
			cacheWriteReadRatio: readPositiveNumber(compact.cacheWriteReadRatio, DEFAULT_CACHE_WRITE_READ_RATIO),
			keepRecentTokens: readPositiveInt(compact.keepRecentTokens, DEFAULT_KEEP_RECENT_TOKENS),
			maxAutoContinuations: readPositiveInt(compact.maxAutoContinuations, DEFAULT_MAX_AUTO_CONTINUATIONS),
		},
	};
}
