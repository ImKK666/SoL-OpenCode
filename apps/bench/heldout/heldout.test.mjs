/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * The held-out discipline must actually hold: the same candidate, the same
 * eval set, one shot. These tests pin the guards, since a silently-broken guard
 * is worse than no guard — it would launder a tuned result as held-out.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonical, hashValue } from "./candidate.mjs";
import { HeldoutViolation, assertDisjoint, assertFrozenMatches, assertHeldoutDeclared, assertOneShot, assertSplitFrozen } from "./guard.mjs";
import { beginHeldoutRun, freezeCandidate, listManifests, loadManifest, recordHeldoutRun, report } from "./index.mjs";
import { splitHash } from "./split.mjs";

const SPLIT = { dev: ["a", "b"], heldout: { dataset: "terminal-bench", tasks: ["x", "y"] } };

describe("canonical", () => {
	it("is independent of key order", () => {
		expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
		expect(hashValue({ b: 1, a: 2 })).toBe(hashValue({ a: 2, b: 1 }));
	});

	it("is stable for nested structures", () => {
		expect(canonical({ a: [{ y: 1, x: 2 }] })).toBe(canonical({ a: [{ x: 2, y: 1 }] }));
	});
});

describe("guards", () => {
	it("rejects an undeclared held-out set", () => {
		expect(() => assertHeldoutDeclared({ dev: ["a"], heldout: null })).toThrow(HeldoutViolation);
		expect(() => assertHeldoutDeclared({ dev: ["a"], heldout: { dataset: "d", tasks: [] } })).toThrow(HeldoutViolation);
	});

	it("rejects overlap between the dev and held-out sets", () => {
		expect(() => assertDisjoint({ dev: ["a", "x"], heldout: { dataset: "d", tasks: ["x"] } })).toThrow(/overlap/);
		expect(() => assertDisjoint(SPLIT)).not.toThrow();
	});

	it("rejects a candidate that drifted since the freeze", () => {
		expect(() => assertFrozenMatches({ freezeId: "f", candidateHash: "deadbeef" }, { package: "p", version: "1" })).toThrow(/drifted/);
	});

	it("rejects a second evaluation of the same freeze", () => {
		expect(() => assertOneShot([{ freezeId: "f", kind: "start" }], "f")).toThrow(/one-shot/);
		// a completed attempt's result row alone must not count as a second attempt
		expect(() => assertOneShot([{ freezeId: "f", kind: "result" }], "f")).not.toThrow();
		expect(() => assertOneShot([], "f")).not.toThrow();
	});

	it("rejects a changed evaluation set", () => {
		const manifest = { freezeId: "f", splitHash: splitHash(SPLIT) };
		expect(() => assertSplitFrozen(manifest, SPLIT)).not.toThrow();
		expect(() => assertSplitFrozen(manifest, { ...SPLIT, heldout: { dataset: "terminal-bench", tasks: ["x"] } })).toThrow(/changed/);
	});
});

describe("freeze -> begin -> record -> report", () => {
	let dir;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "sol-heldout-"));
		process.env.SOL_BENCH_MANIFESTS = join(dir, "manifests");
		process.env.SOL_BENCH_LEDGER = join(dir, "ledger.jsonl");
	});

	afterEach(() => {
		delete process.env.SOL_BENCH_MANIFESTS;
		delete process.env.SOL_BENCH_LEDGER;
		rmSync(dir, { recursive: true, force: true });
	});

	it("freezes a candidate, runs it once, and reports from the ledger", () => {
		const manifest = freezeCandidate({ split: SPLIT, label: "test" });
		expect(listManifests()).toHaveLength(1);
		expect(loadManifest(manifest.freezeId).split.heldout.tasks).toEqual(["x", "y"]);

		beginHeldoutRun(manifest.freezeId, { split: SPLIT });
		recordHeldoutRun(manifest.freezeId, { solved: 1, total: 2, tokens: 100, cost: 0.01 });

		const summary = report(manifest.freezeId);
		expect(summary.attempts).toBe(1);
		expect(summary.solved).toBe(1);
		expect(summary.tasks).toBe(2);
		expect(summary.cost).toBeCloseTo(0.01);

		expect(() => beginHeldoutRun(manifest.freezeId, { split: SPLIT })).toThrow(/one-shot/);
	});

	it("refuses to begin a run with no freeze", () => {
		expect(() => beginHeldoutRun("deadbeef", { split: SPLIT })).toThrow(/no frozen manifest/);
	});
});
