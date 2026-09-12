/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	THRESHOLD_BYTES,
	createObservation,
	ensureStored,
	isObservationId,
	placeholderFor,
	readRecallChunk,
	searchObservation,
} from "../src/observation-pack/observation.ts";

function multilineText(lines = 400): string {
	return Array.from({ length: lines }, (_value, index) => `line ${index} ${"x".repeat(30)}\n`).join("");
}

async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "sol-observation-"));
	try {
		return await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("createObservation", () => {
	it("ignores results at or below the threshold", () => {
		const text = "x".repeat(THRESHOLD_BYTES);
		expect(createObservation({ toolName: "bash", toolCallId: "c1", text }, "/tmp/root")).toBeUndefined();
	});

	it("derives a stable, well-formed id above the threshold", () => {
		const text = "x".repeat(THRESHOLD_BYTES + 1);
		const first = createObservation({ toolName: "bash", toolCallId: "c1", text }, "/tmp/root");
		const second = createObservation({ toolName: "bash", toolCallId: "c1", text }, "/tmp/root");
		expect(first?.id).toBe(second?.id);
		expect(first !== undefined && isObservationId(first.id)).toBe(true);
		expect(first?.bytes).toBe(THRESHOLD_BYTES + 1);
	});

	it("excludes evidence-reducer receipts from packing", () => {
		const text = `sol_opencode_evidence_receipt_v1\n${"x".repeat(THRESHOLD_BYTES)}`;
		expect(createObservation({ toolName: "bash", toolCallId: "c1", text }, "/tmp/root")).toBeUndefined();
	});
});

describe("placeholderFor", () => {
	it("is deterministic and embeds head and tail excerpts", () => {
		const observation = createObservation({ toolName: "bash", toolCallId: "c1", text: multilineText() }, "/tmp/root");
		if (!observation) throw new Error("expected an observation");
		const first = placeholderFor(observation);
		const second = placeholderFor(observation);
		expect(first).toBe(second);
		expect(first).toContain(`id: ${observation.id}`);
		expect(first).toContain(`original_bytes: ${observation.bytes}`);
		expect(first).toContain("line 0 ");
		expect(first).toContain("line 399 ");
	});
});

describe("ensureStored", () => {
	it("writes the object and is idempotent for identical bytes", async () => {
		await withRoot(async (root) => {
			const text = multilineText();
			const observation = createObservation({ toolName: "bash", toolCallId: "c1", text }, root);
			if (!observation) throw new Error("expected an observation");
			await ensureStored(observation);
			expect(await readFile(observation.filePath, "utf8")).toBe(text);
			await ensureStored(observation);
		});
	});

	it("rejects a conflicting object at the same path", async () => {
		await withRoot(async (root) => {
			const observation = createObservation({ toolName: "bash", toolCallId: "c1", text: multilineText() }, root);
			if (!observation) throw new Error("expected an observation");
			await ensureStored(observation);
			await writeFile(observation.filePath, "tampered", "utf8");
			await expect(ensureStored(observation)).rejects.toThrow();
		});
	});
});

describe("readRecallChunk", () => {
	it("pages by bytes and lines with an accurate eof", async () => {
		await withRoot(async (root) => {
			const text = "aaaa\nbbbb\ncccc\ndddd\n";
			const observation = createObservation(
				{ toolName: "bash", toolCallId: "c1", text: `${text}${"z".repeat(THRESHOLD_BYTES)}` },
				root,
			);
			if (!observation) throw new Error("expected an observation");
			// The archive stores the full text; page over the whole file.
			await ensureStored(observation);
			const first = await readRecallChunk(observation.filePath, 0, { maxBytes: 10, maxLines: 2 });
			expect(first.text).toBe("aaaa\nbbbb\n");
			expect(first.lines).toBe(2);
			expect(first.eof).toBe(false);
			const second = await readRecallChunk(observation.filePath, first.nextOffset, { maxBytes: 10, maxLines: 2 });
			expect(second.text).toBe("cccc\ndddd\n");
		});
	});
});

describe("searchObservation", () => {
	it("finds literal matches with LF-based line numbers and bounded context", async () => {
		await withRoot(async (root) => {
			const observation = createObservation(
				{ toolName: "bash", toolCallId: "c1", text: multilineText(600) },
				root,
			);
			if (!observation) throw new Error("expected an observation");
			await ensureStored(observation);
			const result = await searchObservation(
				observation.filePath,
				Buffer.from("line 500 ", "utf8"),
				0,
				16 * 1024,
				undefined,
			);
			expect(result.matches.length).toBe(1);
			expect(result.matches[0]?.line).toBe(501);
			expect(result.matches[0]?.context).toContain("line 500 ");
			expect(result.eof).toBe(true);
		});
	});
});
