/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import type { Hooks, PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { SolConfig } from "./config.ts";
import { sessionRoot as computeSessionRoot } from "./storage.ts";

export interface SolKernel {
	readonly input: PluginInput;
	readonly config: SolConfig;
	sessionRoot(sessionID: string): string;
	isAuxSession(sessionID: string): boolean;
	markAuxSession(sessionID: string): void;
	log(message: string): void;
}

export function createKernel(input: PluginInput, config: SolConfig): SolKernel {
	const auxSessions = new Set<string>();
	return {
		input,
		config,
		sessionRoot: (sessionID) => computeSessionRoot(input.directory, sessionID),
		isAuxSession: (sessionID) => auxSessions.has(sessionID),
		markAuxSession: (sessionID) => {
			auxSessions.add(sessionID);
		},
		log: (message) => {
			console.error(`[sol-opencode] ${message}`);
		},
	};
}

// ---------------------------------------------------------------------------
// Hook bus
//
// Mechanisms register handlers; the bus fans them out in registration order.
// OpenCode chains hooks across plugins sequentially and lets handlers mutate
// `output` in place, so ordered fan-out preserves each mechanism's semantics.
// Every handler is individually guarded: a mechanism bug must never break the
// agent.
// ---------------------------------------------------------------------------

export interface OpenCodeEvent {
	readonly type?: string;
	readonly properties?: Record<string, unknown>;
	readonly [key: string]: unknown;
}

export interface ToolBeforeInput {
	readonly tool?: string;
	readonly sessionID?: string;
	readonly callID?: string;
	readonly [key: string]: unknown;
}

export interface ToolAfterInput extends ToolBeforeInput {
	readonly args?: unknown;
}

export interface ToolAfterOutput {
	title?: string;
	output?: string;
	metadata?: unknown;
	[key: string]: unknown;
}

export interface ToolDefinitionInput {
	readonly toolID?: string;
	readonly [key: string]: unknown;
}

export interface ToolDefinitionOutput {
	description?: string;
	parameters?: unknown;
	jsonSchema?: unknown;
	[key: string]: unknown;
}

export interface MessageLike {
	info?: { role?: string; sessionID?: string; [key: string]: unknown };
	parts?: unknown[];
	[key: string]: unknown;
}

export interface MessagesTransformOutput {
	messages: MessageLike[];
	[key: string]: unknown;
}

export interface SessionCompactingInput {
	readonly sessionID?: string;
	readonly [key: string]: unknown;
}

export interface SessionCompactingOutput {
	context?: string[];
	prompt?: string;
	[key: string]: unknown;
}

export interface CompactionAutocontinueInput {
	readonly sessionID?: string;
	readonly [key: string]: unknown;
}

export interface CompactionAutocontinueOutput {
	enabled?: boolean;
	[key: string]: unknown;
}

export type ToolBeforeOutput = { args?: unknown } & Record<string, unknown>;

export type EventHandler = (event: OpenCodeEvent) => void | Promise<void>;
export type ToolBeforeHandler = (input: ToolBeforeInput, output: ToolBeforeOutput) => void | Promise<void>;
export type ToolAfterHandler = (input: ToolAfterInput, output: ToolAfterOutput) => void | Promise<void>;
export type ToolDefinitionHandler = (
	input: ToolDefinitionInput,
	output: ToolDefinitionOutput,
) => void | Promise<void>;
export type MessagesTransformHandler = (input: unknown, output: MessagesTransformOutput) => void | Promise<void>;
export type SessionCompactingHandler = (
	input: SessionCompactingInput,
	output: SessionCompactingOutput,
) => void | Promise<void>;
export type CompactionAutocontinueHandler = (
	input: CompactionAutocontinueInput,
	output: CompactionAutocontinueOutput,
) => void | Promise<void>;

export class HookBus {
	private readonly events: EventHandler[] = [];
	private readonly toolBefore: ToolBeforeHandler[] = [];
	private readonly toolAfter: ToolAfterHandler[] = [];
	private readonly toolDefinition: ToolDefinitionHandler[] = [];
	private readonly messagesTransforms: MessagesTransformHandler[] = [];
	private readonly sessionCompacting: SessionCompactingHandler[] = [];
	private readonly compactionAutocontinue: CompactionAutocontinueHandler[] = [];
	private readonly tools: Record<string, ToolDefinition> = {};

	onEvent(handler: EventHandler): void {
		this.events.push(handler);
	}

	onToolBefore(handler: ToolBeforeHandler): void {
		this.toolBefore.push(handler);
	}

	onToolAfter(handler: ToolAfterHandler): void {
		this.toolAfter.push(handler);
	}

	onToolDefinition(handler: ToolDefinitionHandler): void {
		this.toolDefinition.push(handler);
	}

	onMessagesTransform(handler: MessagesTransformHandler): void {
		this.messagesTransforms.push(handler);
	}

	onSessionCompacting(handler: SessionCompactingHandler): void {
		this.sessionCompacting.push(handler);
	}

	onCompactionAutocontinue(handler: CompactionAutocontinueHandler): void {
		this.compactionAutocontinue.push(handler);
	}

	registerTool(name: string, definition: ToolDefinition): void {
		this.tools[name] = definition;
	}

	build(onError: (error: unknown) => void): Hooks {
		const hooks: Record<string, unknown> = {};
		const guard = <I, O>(
			handlers: readonly ((input: I, output: O) => void | Promise<void>)[],
		): ((input: I, output: O) => Promise<void>) => {
			return async (input: I, output: O): Promise<void> => {
				for (const handler of handlers) {
					try {
						await handler(input, output);
					} catch (error) {
						onError(error);
					}
				}
			};
		};

		if (this.events.length > 0) {
			hooks["event"] = async (input: { event: OpenCodeEvent }): Promise<void> => {
				for (const handler of this.events) {
					try {
						await handler(input.event);
					} catch (error) {
						onError(error);
					}
				}
			};
		}
		if (this.toolBefore.length > 0) hooks["tool.execute.before"] = guard(this.toolBefore);
		if (this.toolAfter.length > 0) hooks["tool.execute.after"] = guard(this.toolAfter);
		if (this.toolDefinition.length > 0) hooks["tool.definition"] = guard(this.toolDefinition);
		if (this.messagesTransforms.length > 0) {
			hooks["experimental.chat.messages.transform"] = guard(this.messagesTransforms);
		}
		if (this.sessionCompacting.length > 0) {
			hooks["experimental.session.compacting"] = guard(this.sessionCompacting);
		}
		if (this.compactionAutocontinue.length > 0) {
			hooks["experimental.compaction.autocontinue"] = guard(this.compactionAutocontinue);
		}
		if (Object.keys(this.tools).length > 0) {
			hooks["tool"] = this.tools;
		}

		// Single boundary cast: the concrete Hooks member signatures live in
		// @opencode-ai/plugin and we construct this object dynamically.
		return hooks as Hooks;
	}
}
