/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	TrajectoryStore,
	type TrajectoryRecord,
	type TrajectoryRecordInput,
	type TrajectoryStatus,
} from "./store.ts";

export const TRAJECTORY_EVENT_SCHEMA = "sol_opencode_trajectory_v1";

/**
 * Trajectory store plus a non-blocking, batched JSONL writer.
 *
 * Writes are metadata-only (kinds, labels, statuses, durations, byte counts and
 * correlation ids) and never block or fail the agent: write errors are logged
 * once and swallowed.
 */
export class TrajectoryRecorder {
	private readonly runId = randomUUID();
	readonly store: TrajectoryStore;
	private readonly directory: string;
	private pending: string[] = [];
	private writes: Promise<void> = Promise.resolve();

	constructor(root: string, maxRecords?: number) {
		this.store = new TrajectoryStore(maxRecords);
		this.directory = join(root, "trajectory-inspector");
	}

	record(input: TrajectoryRecordInput, timestamp = Date.now()): TrajectoryRecord {
		const record = this.store.record(input, timestamp);
		this.enqueue({ event: "record", ...record });
		return record;
	}

	update(
		sequence: number,
		update: { readonly status?: TrajectoryStatus; readonly durationMs?: number; readonly detail?: string },
	): TrajectoryRecord | undefined {
		const record = this.store.update(sequence, update);
		// Keep completion metadata in the durable stream even after a record has
		// fallen out of the bounded UI tail.
		this.enqueue({ event: "update", sequence, ...update, timestamp: Date.now() });
		return record;
	}

	async flush(): Promise<void> {
		await this.writes;
	}

	private enqueue(entry: Record<string, unknown>): void {
		this.pending.push(`${JSON.stringify({ schema: TRAJECTORY_EVENT_SCHEMA, runId: this.runId, ...entry })}\n`);
		this.writes = this.writes
			.then(async () => {
				if (this.pending.length === 0) return;
				await mkdir(this.directory, { recursive: true });
				while (this.pending.length > 0) {
					const batch = this.pending.join("");
					this.pending = [];
					await appendFile(join(this.directory, "events.jsonl"), batch, "utf8");
				}
			})
			.catch((error) => {
				this.pending = [];
				// Observability must never change the agent's behavior.
				console.error(
					`[trajectory-inspector] ledger write failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	}
}
