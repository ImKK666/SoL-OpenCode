/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveToolPath, withFusedFileQueue } from "../src/action-fusion/file-queue.ts";

describe("resolveToolPath", () => {
	it("strips the @ prefix, normalizes unicode spaces and resolves against cwd", () => {
		expect(resolveToolPath("/work", "@src/a.ts")).toBe("/work/src/a.ts");
		expect(resolveToolPath("/work", "src/\u00A0a.ts")).toBe("/work/src/ a.ts");
	});

	it("expands file URLs and home shortcuts", () => {
		expect(resolveToolPath("/work", "file:///tmp/x.ts")).toBe("/tmp/x.ts");
		expect(resolveToolPath("/work", "~/x.ts").startsWith("/")).toBe(true);
	});
});

describe("withFusedFileQueue", () => {
	it("serializes work per canonical path and preserves result order", async () => {
		const root = await mkdtemp(join(tmpdir(), "sol-queue-"));
		try {
			const file = join(root, "a.ts");
			const order: string[] = [];

			const slow = withFusedFileQueue(file, async () => {
				order.push("first:start");
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
				order.push("first:end");
				return 1;
			});
			const fast = withFusedFileQueue(file, async () => {
				order.push("second:start");
				order.push("second:end");
				return 2;
			});

			const results = await Promise.all([slow, fast]);
			expect(results).toEqual([1, 2]);
			// Acquisition order is not guaranteed (each caller awaits realpath
			// first); what matters is that the two works do not interleave.
			expect(order).toHaveLength(4);
			const sequential =
				order.join(",") === "first:start,first:end,second:start,second:end" ||
				order.join(",") === "second:start,second:end,first:start,first:end";
			expect(sequential).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("releases the queue even when work throws", async () => {
		const root = await mkdtemp(join(tmpdir(), "sol-queue-"));
		try {
			const file = join(root, "b.ts");
			await expect(
				withFusedFileQueue(file, async () => {
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			await expect(withFusedFileQueue(file, async () => "ok")).resolves.toBe("ok");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
