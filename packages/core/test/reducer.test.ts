/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archiveBody } from "../src/reducer/archive.ts";
import { ReceiptCache } from "../src/reducer/cache.ts";
import { REDUCER_RECEIPT_PREFIX, REDUCER_RECEIPT_SCHEMA, loadReducerConfig } from "../src/reducer/config.ts";
import type { ReducerModelResult } from "../src/reducer/model.ts";
import { evaluateReducerGates, reducerCacheKey } from "../src/reducer/policy.ts";
import { receiptText, validateReceipt } from "../src/reducer/receipt.ts";

async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "sol-reducer-"));
	try {
		return await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const PROVIDER: ReducerModelResult = {
	errorMessage: undefined,
	model: "m",
	ok: true,
	outputText: "",
	provider: "p",
	stopReason: "stop",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
};

describe("archiveBody", () => {
	it("stores content-addressed objects and reuses identical bytes", async () => {
		await withRoot(async (root) => {
			const body = "line one\nline two\n";
			const first = await archiveBody(root, body);
			const second = await archiveBody(root, body);
			expect(second.hash).toBe(first.hash);
			expect(second.path).toBe(first.path);
			expect(await readFile(first.path, "utf8")).toBe(body);
		});
	});

	it("rejects a conflicting object at the same hash path", async () => {
		await withRoot(async (root) => {
			const body = "aaa";
			const archive = await archiveBody(root, body);
			await writeFile(archive.path, "tampered", "utf8");
			await expect(archiveBody(root, body)).rejects.toThrow();
		});
	});
});

describe("validateReceipt", () => {
	const body = "error: boom\nnote: ok\n";

	it("accepts a fully verifiable failure receipt with line numbers", async () => {
		await withRoot(async (root) => {
			const archive = await archiveBody(root, body);
			const receipt = JSON.stringify({
				schema: REDUCER_RECEIPT_SCHEMA,
				source_sha256: archive.hash,
				status: "failure",
				uncertain: false,
				evidence: [{ kind: "failure", quote: "error: boom" }],
			});
			const result = validateReceipt(receipt, archive, body, true);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value.evidence[0]?.line).toBe(1);
		});
	});

	it("rejects quotes that are not in the archive", async () => {
		await withRoot(async (root) => {
			const archive = await archiveBody(root, body);
			const receipt = JSON.stringify({
				schema: REDUCER_RECEIPT_SCHEMA,
				source_sha256: archive.hash,
				status: "failure",
				uncertain: false,
				evidence: [{ kind: "failure", quote: "not in body" }],
			});
			expect(validateReceipt(receipt, archive, body, true)).toEqual({ ok: false, reason: "unverifiable-quote" });
		});
	});

	it("rejects a schema or source-hash mismatch", async () => {
		await withRoot(async (root) => {
			const archive = await archiveBody(root, body);
			const receipt = JSON.stringify({
				schema: "wrong",
				source_sha256: archive.hash,
				status: "failure",
				uncertain: false,
				evidence: [],
			});
			expect(validateReceipt(receipt, archive, body, true).ok).toBe(false);
		});
	});

	it("requires failure evidence for a failing log that signals failure", async () => {
		await withRoot(async (root) => {
			const archive = await archiveBody(root, body);
			const receipt = JSON.stringify({
				schema: REDUCER_RECEIPT_SCHEMA,
				source_sha256: archive.hash,
				status: "failure",
				uncertain: true,
				evidence: [],
			});
			expect(validateReceipt(receipt, archive, body, true)).toEqual({
				ok: false,
				reason: "missing-failure-evidence",
			});
		});
	});
});

describe("receiptText", () => {
	it("starts with the prefix the observation pack uses to exclude receipts", async () => {
		await withRoot(async (root) => {
			const body = "error: x\n";
			const archive = await archiveBody(root, body);
			const result = validateReceipt(
				JSON.stringify({
					schema: REDUCER_RECEIPT_SCHEMA,
					source_sha256: archive.hash,
					status: "failure",
					uncertain: false,
					evidence: [{ kind: "failure", quote: "error: x" }],
				}),
				archive,
				body,
				true,
			);
			if (!result.ok) throw new Error("expected a valid receipt");
			const text = receiptText("cargo build", archive, result.value, PROVIDER);
			expect(text.split("\n")[0]).toBe(REDUCER_RECEIPT_PREFIX);
			expect(text).toContain(`source_artifact=${archive.path}`);
		});
	});
});

describe("reducer policy", () => {
	const config = loadReducerConfig("/tmp/sol-reducer-root");

	it("gates on diagnostic commands, size and secrets", () => {
		const big = "x".repeat(config.minBytes + 1);
		expect(evaluateReducerGates("cargo build", big, config)).toEqual({ eligible: true });
		expect(evaluateReducerGates("echo hi", big, config)).toEqual({ eligible: false, reason: "not-diagnostic" });
		expect(evaluateReducerGates("cargo build", "x", config)).toEqual({ eligible: false, reason: "below-min-bytes" });
		expect(evaluateReducerGates("cargo build", `${big}\napi_key=abcdef123456`, config)).toEqual({
			eligible: false,
			reason: "likely-secret",
		});
	});

	it("builds a stable cache key that changes with the command", () => {
		const a = reducerCacheKey(config, "hash", "cargo build", false);
		expect(reducerCacheKey(config, "hash", "cargo build", false)).toBe(a);
		expect(reducerCacheKey(config, "hash", "cargo test", false)).not.toBe(a);
	});
});

describe("ReceiptCache", () => {
	it("zeroes usage on a hit and evicts beyond capacity", () => {
		const cache = new ReceiptCache(2);
		const value: ReducerModelResult = {
			...PROVIDER,
			usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
		};
		cache.set("a", value);
		expect(cache.get("a")?.usage.totalTokens).toBe(0);
		cache.set("b", value);
		cache.set("c", value);
		expect(cache.get("a")).toBeUndefined();
	});
});
