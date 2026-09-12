/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { tool } from "@opencode-ai/plugin";
import { TrajectoryRecorder } from "@alicekk/sol-opencode-core";
import type {
	HookBus,
	OpenCodeEvent,
	SolKernel,
	ToolAfterInput,
	ToolBeforeInput,
} from "../kernel.ts";

function str(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

/**
 * Trajectory Inspector — metadata-only observability.
 *
 * Records event kinds, timestamps, statuses, tool names, durations and
 * correlation ids. It never stores prompts, assistant text, tool arguments or
 * tool output, and never mutates tool behaviour.
 */
export function registerTrajectory(kernel: SolKernel, bus: HookBus): void {
	const { maxRecords } = kernel.config.trajectoryInspector;
	const recorders = new Map<string, TrajectoryRecorder>();
	const toolSpans = new Map<string, { readonly sequence: number; readonly startedAt: number }>();
	const seenMessages = new Set<string>();

	const recorderFor = (sessionID: string): TrajectoryRecorder | undefined => {
		if (sessionID === "" || kernel.isAuxSession(sessionID)) return undefined;
		let recorder = recorders.get(sessionID);
		if (recorder === undefined) {
			recorder = new TrajectoryRecorder(kernel.sessionRoot(sessionID), maxRecords);
			recorders.set(sessionID, recorder);
		}
		return recorder;
	};

	bus.onEvent((event: OpenCodeEvent): void => {
		const type = str(event.type);
		const properties = (event.properties ?? {}) as Record<string, unknown>;
		const sessionID = str(properties["sessionID"]) || str(properties["id"]);

		switch (type) {
			case "session.created":
			case "session.deleted":
			case "session.updated":
				recorderFor(sessionID)?.record({
					kind: "session",
					label: type.replace("session.", "session "),
					status: "info",
				});
				break;
			case "session.idle":
				recorderFor(sessionID)?.record({ kind: "turn", label: "turn end", status: "ok" });
				break;
			case "session.compacted":
				recorderFor(sessionID)?.record({ kind: "compact", label: "compaction", status: "ok" });
				break;
			case "session.error":
				recorderFor(sessionID)?.record({ kind: "error", label: "session error", status: "error" });
				break;
			case "todo.updated":
				recorderFor(sessionID)?.record({ kind: "plan", label: "todos updated", status: "info" });
				break;
			case "message.updated": {
				// One span per assistant message: subsequent updates for the same
				// message id are streaming noise.
				const messageID = str(properties["messageID"]);
				if (messageID === "") break;
				const key = `${sessionID}:${messageID}`;
				if (seenMessages.has(key)) break;
				seenMessages.add(key);
				recorderFor(sessionID)?.record({ kind: "message", label: "assistant message", status: "info" });
				break;
			}
			default:
				break;
		}
	});

	bus.onToolBefore((input: ToolBeforeInput): void => {
		const sessionID = str(input.sessionID);
		const callID = str(input.callID);
		const tool = str(input.tool, "tool");
		const recorder = recorderFor(sessionID);
		if (recorder === undefined) return;

		const startedAt = Date.now();
		const record = recorder.record(
			{
				kind: "tool",
				label: `tool ${tool}`,
				status: "running",
				...(callID === "" ? {} : { correlationId: callID }),
			},
			startedAt,
		);
		if (callID !== "") toolSpans.set(`${sessionID}:${callID}`, { sequence: record.sequence, startedAt });
	});

	bus.onToolAfter((input: ToolAfterInput): void => {
		const sessionID = str(input.sessionID);
		const callID = str(input.callID);
		const tool = str(input.tool, "tool");
		const recorder = recorderFor(sessionID);
		if (recorder === undefined) return;

		const span = callID === "" ? undefined : toolSpans.get(`${sessionID}:${callID}`);
		if (span === undefined) {
			// Tool ran without an observed start (or across a plugin reload).
			recorder.record({ kind: "tool", label: `tool ${tool}`, status: "ok" });
			return;
		}
		toolSpans.delete(`${sessionID}:${callID}`);
		// NOTE: error detection in the after hook is an open spike (DESIGN §11);
		// until resolved the completed status is optimistic.
		recorder.update(span.sequence, { status: "ok", durationMs: Math.max(0, Date.now() - span.startedAt) });
	});

	bus.registerTool(
		"sol_trajectory",
		tool({
			description: "Show recent metadata-only SoL trajectory records for this session (diagnostic).",
			args: { limit: tool.schema.number().optional() },
			async execute(args, context) {
				const recorder = recorders.get(context.sessionID);
				if (recorder === undefined) return "No trajectory records for this session.";
				const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : maxRecords;
				const records = recorder.store.snapshot().slice(-limit);
				if (records.length === 0) return "No trajectory records for this session.";
				return records
					.map((record) => {
						const detail = record.detail === undefined ? "" : ` · ${record.detail}`;
						const duration =
							record.durationMs === undefined ? "" : ` (${Math.round(record.durationMs)}ms)`;
						return `${record.sequence} ${new Date(record.timestamp).toISOString()} ${record.status} ${record.kind} ${record.label}${detail}${duration}`;
					})
					.join("\n");
			},
		}),
	);
}
