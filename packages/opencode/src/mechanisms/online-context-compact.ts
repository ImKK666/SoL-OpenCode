/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	DEFAULT_COMPACTION_ECONOMICS,
	analyzePlanTransition,
	decideCompaction,
	estimateTokens,
	parsePlanSteps,
	type PlanStep,
} from "@alicekk/sol-opencode-core";
import type { HookBus, MessageLike, MessagesTransformOutput, OpenCodeEvent, SolKernel } from "../kernel.ts";

const BOUNDARY_COMPACTION_INSTRUCTIONS =
	"Preserve completed work, verification results, important decisions, and remaining work.";
const MEMO_TOKENS = 1_000;
const MAX_HISTORY = 20;

interface OccState {
	plan: readonly PlanStep[];
	pendingBoundary: boolean;
	requestCount: number;
	contextTokens: number;
	previousTokens: number;
	increments: number[];
	boundaryRequests: number[];
	boundaryStart: number;
	priorCompactionCount: number;
	autoContinuations: number;
	inFlight: boolean;
	providerID?: string;
	modelID?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionIdOf(messages: readonly MessageLike[]): string | undefined {
	for (const message of messages) {
		const sessionID = message.info?.sessionID;
		if (typeof sessionID === "string" && sessionID.length > 0) return sessionID;
	}
	return undefined;
}

function estimateMessagesTokens(messages: readonly MessageLike[]): number {
	let total = 0;
	for (const message of messages) {
		const parts = message.parts;
		if (!Array.isArray(parts)) continue;
		for (const part of parts) {
			if (!isRecord(part)) continue;
			if (part["type"] === "text" && typeof part["text"] === "string") {
				total += estimateTokens(part["text"]);
			} else if (part["type"] === "tool") {
				const state = part["state"];
				if (isRecord(state) && typeof state["output"] === "string") total += estimateTokens(state["output"]);
			}
		}
	}
	return total;
}

function average(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function todosToPlan(todos: unknown): readonly PlanStep[] | undefined {
	if (!Array.isArray(todos)) return undefined;
	const steps: PlanStep[] = [];
	for (const todo of todos) {
		if (!isRecord(todo)) return undefined;
		const id = todo["id"];
		const goal = todo["content"];
		if (typeof id !== "string" || typeof goal !== "string") return undefined;
		const status = todo["status"];
		if (status === "cancelled") continue;
		steps.push({
			id,
			goal,
			status: status === "completed" || status === "in_progress" ? status : "pending",
		});
	}
	return parsePlanSteps(steps);
}

function initialState(): OccState {
	return {
		plan: [],
		pendingBoundary: false,
		requestCount: 0,
		contextTokens: 0,
		previousTokens: 0,
		increments: [],
		boundaryRequests: [],
		boundaryStart: 0,
		priorCompactionCount: 0,
		autoContinuations: 0,
		inFlight: false,
	};
}

/**
 * Online Context Compact — trigger OpenCode's native compaction at economic,
 * plan-aware points.
 *
 * Native `todo.updated` events supply the plan; a newly completed step opens a
 * boundary. At `session.idle` the boundary is priced with core economics and,
 * when favorable, `session.summarize` is called. Loop guards: a boundary is
 * consumed on use, an in-flight flag prevents double-triggering, and
 * `maxAutoContinuations` caps how many times a session may auto-continue.
 */
export function registerOnlineContextCompact(kernel: SolKernel, bus: HookBus): void {
	const { cacheWriteReadRatio, keepRecentTokens, maxAutoContinuations } = kernel.config.onlineContextCompact;
	const states = new Map<string, OccState>();

	const stateFor = (sessionID: string): OccState => {
		let state = states.get(sessionID);
		if (state === undefined) {
			state = initialState();
			states.set(sessionID, state);
		}
		return state;
	};

	const persist = (sessionID: string, state: OccState): void => {
		const path = join(kernel.sessionRoot(sessionID), "online-context-compact", "state.json");
		const payload = JSON.stringify({
			schema: "sol_opencode_online_context_compact/1",
			plan: state.plan,
			pendingBoundary: state.pendingBoundary,
			requestCount: state.requestCount,
			contextTokens: state.contextTokens,
			boundaryRequests: state.boundaryRequests,
			priorCompactionCount: state.priorCompactionCount,
			autoContinuations: state.autoContinuations,
			providerID: state.providerID,
			modelID: state.modelID,
		});
		void mkdir(dirname(path), { recursive: true })
			.then(() => writeFile(path, payload, "utf8"))
			.catch(() => undefined);
	};

	const maybeCompact = async (sessionID: string, state: OccState): Promise<void> => {
		if (!state.pendingBoundary || state.inFlight) return;
		if (state.autoContinuations >= maxAutoContinuations) return;
		const { providerID, modelID } = state;
		if (providerID === undefined || modelID === undefined) return;

		const decision = decideCompaction({
			writeTokens: state.contextTokens,
			archiveTokens: Math.max(0, state.contextTokens - keepRecentTokens),
			memoTokens: MEMO_TOKENS,
			contextTokens: state.contextTokens,
			completedBoundaryRequestCounts: state.boundaryRequests.length > 0 ? [...state.boundaryRequests] : null,
			remainingBoundaries: state.plan.filter((step) => step.status !== "completed").length,
			averageContextTokenIncrement: average(state.increments),
			contextWindowTokens: null,
			priorCompactionCount: state.priorCompactionCount,
			carriedDebtTokens: 0,
			cacheDebtRepaymentTokens: 0,
			cacheWriteReadRatio,
			economics: DEFAULT_COMPACTION_ECONOMICS,
		});
		if (!decision.compact) return;

		state.inFlight = true;
		try {
			await kernel.input.client.session.summarize({
				path: { id: sessionID },
				query: { directory: kernel.input.directory },
				body: { providerID, modelID },
			});
			state.pendingBoundary = false;
		} catch (error) {
			kernel.log(
				`online-context-compact summarize failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			state.inFlight = false;
			persist(sessionID, state);
		}
	};

	bus.onMessagesTransform((_input: unknown, output: MessagesTransformOutput): void => {
		const messages = output.messages;
		if (!Array.isArray(messages) || messages.length === 0) return;
		const sessionID = sessionIdOf(messages);
		if (sessionID === undefined || kernel.isAuxSession(sessionID)) return;
		const state = stateFor(sessionID);
		const tokens = estimateMessagesTokens(messages);
		const increment = tokens - state.previousTokens;
		if (increment > 0) state.increments.push(increment);
		if (state.increments.length > MAX_HISTORY) state.increments.shift();
		state.requestCount += 1;
		state.previousTokens = tokens;
		state.contextTokens = tokens;
	});

	bus.onEvent((event: OpenCodeEvent): void => {
		const type = typeof event.type === "string" ? event.type : "";
		const properties = isRecord(event.properties) ? event.properties : {};
		const sessionID = typeof properties["sessionID"] === "string" ? properties["sessionID"] : undefined;
		if (sessionID === undefined || kernel.isAuxSession(sessionID)) return;
		const state = stateFor(sessionID);

		if (type === "message.updated") {
			const info = isRecord(properties["info"]) ? properties["info"] : undefined;
			if (info?.["role"] === "assistant") {
				if (typeof info["providerID"] === "string") state.providerID = info["providerID"];
				if (typeof info["modelID"] === "string") state.modelID = info["modelID"];
			}
			return;
		}
		if (type === "todo.updated") {
			const plan = todosToPlan(properties["todos"]);
			if (plan === undefined) return;
			const transition = analyzePlanTransition(state.plan, plan);
			state.plan = plan;
			if (transition.completedSteps.length > 0) {
				state.pendingBoundary = true;
				state.boundaryRequests.push(Math.max(1, state.requestCount - state.boundaryStart));
				if (state.boundaryRequests.length > 12) state.boundaryRequests.shift();
				state.boundaryStart = state.requestCount;
			}
			return;
		}
		if (type === "session.idle") {
			void maybeCompact(sessionID, state);
			return;
		}
		if (type === "session.compacted") {
			state.priorCompactionCount += 1;
			state.pendingBoundary = false;
			state.autoContinuations += 1;
			persist(sessionID, state);
			return;
		}
		if (type === "session.error") {
			state.inFlight = false;
		}
	});

	bus.onSessionCompacting((_input, output): void => {
		output.context = [...(output.context ?? []), BOUNDARY_COMPACTION_INSTRUCTIONS];
	});
}
