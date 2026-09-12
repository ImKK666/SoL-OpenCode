/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runThenRun } from "../src/action-fusion/then-run.ts";

async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "sol-then-run-"));
	try {
		return await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("runThenRun", () => {
	it("runs the command after the target is confirmed unchanged", async () => {
		await withRoot(async (root) => {
			const file = join(root, "a.ts");
			await writeFile(file, "one\n", "utf8");
			const outcome = await runThenRun({
				absolutePath: file,
				thenRun: { command: "npm test" },
				runCommand: async () => "all green",
			});
			expect(outcome).toEqual({ status: "succeeded", output: "all green" });
		});
	});

	it("returns a failed outcome when the command throws", async () => {
		await withRoot(async (root) => {
			const file = join(root, "b.ts");
			await writeFile(file, "x\n", "utf8");
			const outcome = await runThenRun({
				absolutePath: file,
				thenRun: { command: "false" },
				runCommand: async () => {
					throw new Error("exit 1");
				},
			});
			expect(outcome).toEqual({ status: "failed", error: "exit 1" });
		});
	});

	it("skips when the target cannot be hashed", async () => {
		await withRoot(async (root) => {
			const outcome = await runThenRun({
				absolutePath: join(root, "missing.ts"),
				thenRun: { command: "true" },
				runCommand: async () => "should not run",
			});
			expect(outcome.status).toBe("skipped");
		});
	});
});
