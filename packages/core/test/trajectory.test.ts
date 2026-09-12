/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRAJECTORY_EVENT_SCHEMA, TrajectoryRecorder } from "../src/trajectory/jsonl.ts";
import { TrajectoryStore, formatTrajectoryBytes, renderTrajectoryLines } from "../src/trajectory/store.ts";

describe("TrajectoryStore", () => {
	it("keeps a bounded ring buffer with monotonic sequence numbers", () => {
		const store = new TrajectoryStore(3);
		store.record({ kind: "tool", label: "a" });
		store.record({ kind: "tool", label: "b" });
		store.record({ kind: "tool", label: "c" });
		const last = store.record({ kind: "tool", label: "d" });
		expect(store.totalRecords).toBe(4);
		expect(last.sequence).toBe(4);
		expect(store.snapshot().map((record) => record.label)).toEqual(["b", "c", "d"]);
	});

	it("rejects invalid capacities", () => {
		expect(() => new TrajectoryStore(0)).toThrow();
		expect(() => new TrajectoryStore(-1)).toThrow();
	});

	it("updates a record in place and strips control sequences from labels", () => {
		const store = new TrajectoryStore();
		const record = store.record({ kind: "tool", label: "run\u001b[31m x\u0007" });
		expect(record.label).not.toContain("\u001b");
		expect(record.label).not.toContain("\u0007");
		expect(store.update(record.sequence, { status: "ok", durationMs: 12 })?.status).toBe("ok");
		expect(store.update(999, { status: "ok" })).toBeUndefined();
	});

	it("formats byte sizes and renders plain lines", () => {
		expect(formatTrajectoryBytes(512)).toBe("512 B");
		expect(formatTrajectoryBytes(2048)).toBe("2.0 KiB");
		const store = new TrajectoryStore();
		expect(renderTrajectoryLines(store)).toHaveLength(2);
		const record = store.record({ kind: "tool", label: "tool bash", status: "ok" });
		store.update(record.sequence, { durationMs: 1500 });
		expect(renderTrajectoryLines(store)).toHaveLength(2);
	});
});

describe("TrajectoryRecorder", () => {
	it("appends schema-tagged JSONL records and flushes", async () => {
		const root = await mkdtemp(join(tmpdir(), "sol-trajectory-"));
		try {
			const recorder = new TrajectoryRecorder(root, 5);
			const record = recorder.record({ kind: "session", label: "session start" });
			recorder.update(record.sequence, { status: "ok" });
			await recorder.flush();

			const text = await readFile(join(root, "trajectory-inspector", "events.jsonl"), "utf8");
			const lines = text
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);

			expect(lines).toHaveLength(2);
			expect(lines[0]?.["schema"]).toBe(TRAJECTORY_EVENT_SCHEMA);
			expect(lines[0]?.["event"]).toBe("record");
			expect(lines[1]?.["event"]).toBe("update");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
