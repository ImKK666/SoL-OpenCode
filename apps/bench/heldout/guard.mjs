/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * The rules that make a held-out run held-out.
 *
 * Upstream SoL-Pi's protocol: a candidate is frozen, evaluated once on an
 * isolated held-out set, and a failed evaluation rejects the candidate without
 * becoming feedback. These guards encode exactly that, and refuse to run when
 * the discipline would be violated.
 */
import { candidateHash } from "./candidate.mjs";
import { splitHash } from "./split.mjs";

export class HeldoutViolation extends Error {
	constructor(message) {
		super(message);
		this.name = "HeldoutViolation";
	}
}

/** The eval set must be declared before a freeze. */
export function assertHeldoutDeclared(split) {
	if (!split.heldout || !Array.isArray(split.heldout.tasks) || split.heldout.tasks.length === 0) {
		throw new HeldoutViolation(
			"no held-out set declared — fill apps/bench/heldout/split.json before freezing a candidate",
		);
	}
	if (!split.heldout.dataset) {
		throw new HeldoutViolation("held-out set must name its dataset");
	}
}

/** A task you tuned on cannot also be an evaluation task. */
export function assertDisjoint(split) {
	assertHeldoutDeclared(split);
	const dev = new Set(split.dev);
	const overlap = split.heldout.tasks.filter((task) => dev.has(task));
	if (overlap.length > 0) {
		throw new HeldoutViolation(`held-out set overlaps the dev set: ${overlap.join(", ")}`);
	}
}

/** The candidate that ran must be the candidate that was frozen. */
export function assertFrozenMatches(manifest, candidate) {
	const live = candidateHash(candidate);
	if (manifest.candidateHash !== live) {
		throw new HeldoutViolation(
			`candidate drifted since freeze ${manifest.freezeId}: frozen ${manifest.candidateHash.slice(0, 12)} != live ${live.slice(0, 12)}. ` +
				"Re-freeze and declare a new evaluation; do not reuse this manifest.",
		);
	}
}

/** One freeze, one evaluation. Re-running to chase a better number is refused. */
export function assertOneShot(entries, freezeId) {
	// Count attempts (the "start" entries), not ledger rows — a completed attempt
	// writes both a start and a result row.
	const attempts = entries.filter((entry) => entry.freezeId === freezeId && entry.kind === "start");
	if (attempts.length > 0) {
		throw new HeldoutViolation(
			`freeze ${freezeId} has already been evaluated (${attempts.length} attempt(s)). ` +
				"Held-out evaluation is one-shot: freeze a new candidate instead of re-running.",
		);
	}
}

/** The held-out set may not change between freeze and run. */
export function assertSplitFrozen(manifest, split) {
	const live = splitHash(split);
	if (manifest.splitHash !== live) {
		throw new HeldoutViolation(
			`held-out split changed since freeze ${manifest.freezeId}: frozen ${manifest.splitHash.slice(0, 12)} != live ${live.slice(0, 12)}. ` +
				"The evaluation set is part of the frozen candidate.",
		);
	}
}
