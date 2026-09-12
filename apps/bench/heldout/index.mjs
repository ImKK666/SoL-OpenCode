/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Held-out discipline API.
 *
 * Lifecycle:
 *   freeze  -> declare the candidate + eval set, write an immutable manifest
 *   begin   -> guards fire, an auditable attempt is recorded
 *   record  -> the result is appended (report-only, never fed back)
 *   report  -> derived from the ledger
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { candidateHash, describeCandidate, hashValue } from "./candidate.mjs";
import { assertDisjoint, assertFrozenMatches, assertHeldoutDeclared, assertOneShot, assertSplitFrozen } from "./guard.mjs";
import { appendEntry, readEntries, runsFor } from "./ledger.mjs";
import { loadSplit, splitHash } from "./split.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export { HeldoutViolation } from "./guard.mjs";
export { ledgerPath, readEntries, runsFor } from "./ledger.mjs";

/** Overridable for tests via SOL_BENCH_MANIFESTS. */
function manifestsDir() {
	return process.env.SOL_BENCH_MANIFESTS ?? join(HERE, "manifests");
}

function manifestPath(freezeId) {
	return join(manifestsDir(), `${freezeId}.json`);
}

/** Declare and freeze a candidate. Fails if the eval set is undeclared or overlaps dev. */
export function freezeCandidate({ model, mechanisms, split = loadSplit(), label = null } = {}) {
	assertHeldoutDeclared(split);
	assertDisjoint(split);
	const candidate = describeCandidate({ model, mechanisms });
	const cHash = candidateHash(candidate);
	const sHash = splitHash(split);
	const freezeId = hashValue({ candidateHash: cHash, splitHash: sHash }).slice(0, 12);
	const manifest = {
		freezeId,
		createdAt: new Date().toISOString(),
		label,
		candidate,
		candidateHash: cHash,
		split,
		splitHash: sHash,
	};
	mkdirSync(manifestsDir(), { recursive: true });
	writeFileSync(manifestPath(freezeId), `${JSON.stringify(manifest, null, 2)}\n`);
	return manifest;
}

export function loadManifest(freezeId) {
	const path = manifestPath(freezeId);
	if (!existsSync(path)) throw new Error(`no frozen manifest ${freezeId} — run \`freeze\` first`);
	return JSON.parse(readFileSync(path, "utf8"));
}

export function listManifests() {
	if (!existsSync(manifestsDir())) return [];
	return readdirSync(manifestsDir())
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(readFileSync(join(manifestsDir(), name), "utf8")))
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Begin a held-out run. Every guard fires before anything executes, and the
 * attempt is recorded so a crash still consumes the one-shot.
 */
export function beginHeldoutRun(freezeId, { model, mechanisms, split = loadSplit() } = {}) {
	const manifest = loadManifest(freezeId);
	assertSplitFrozen(manifest, split);
	assertFrozenMatches(manifest, describeCandidate({ model, mechanisms }));
	assertOneShot(readEntries(), freezeId);
	return appendEntry({ kind: "start", freezeId, candidateHash: manifest.candidateHash, splitHash: manifest.splitHash });
}

/** Record the outcome. Report-only — never consumed by a tuning loop. */
export function recordHeldoutRun(freezeId, result) {
	return appendEntry({ kind: "result", freezeId, ...result });
}

/** Derived purely from the ledger. */
export function report(freezeId) {
	const entries = runsFor(freezeId);
	const results = entries.filter((entry) => entry.kind === "result");
	return {
		freezeId,
		attempts: entries.filter((entry) => entry.kind === "start").length,
		results,
		solved: results.reduce((total, entry) => total + (entry.solved ?? 0), 0),
		tasks: results.reduce((total, entry) => total + (entry.total ?? 0), 0),
		cost: results.reduce((total, entry) => total + (entry.cost ?? 0), 0),
		tokens: results.reduce((total, entry) => total + (entry.tokens ?? 0), 0),
	};
}
