/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Append-only evaluation ledger.
 *
 * Held-out results are written here once and never mutated. The report reads
 * only from the ledger, so a number cannot be edited into existence — a new
 * attempt is a new (auditable) entry, not an overwrite.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Overridable for tests via SOL_BENCH_LEDGER. */
export function ledgerPath() {
	return process.env.SOL_BENCH_LEDGER ?? join(HERE, "ledger.jsonl");
}

/** Append one immutable entry. Returns the entry as written. */
export function appendEntry(entry) {
	mkdirSync(HERE, { recursive: true });
	const record = { ...entry, ts: new Date().toISOString() };
	appendFileSync(ledgerPath(), `${JSON.stringify(record)}\n`);
	return record;
}

export function readEntries() {
	if (!existsSync(ledgerPath())) return [];
	return readFileSync(ledgerPath(), "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
}

export function runsFor(freezeId) {
	return readEntries().filter((entry) => entry.freezeId === freezeId);
}
