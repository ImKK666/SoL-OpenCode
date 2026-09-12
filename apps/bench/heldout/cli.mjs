/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Held-out discipline CLI.
 *
 *   node apps/bench/heldout/cli.mjs freeze --label "..." [--model provider/model]
 *   node apps/bench/heldout/cli.mjs status
 *   node apps/bench/heldout/cli.mjs report [--freeze-id <id>]
 */
import { DEFAULT_MODEL } from "../config.mjs";
import { describeCandidate } from "./candidate.mjs";
import { assertFrozenMatches, assertSplitFrozen } from "./guard.mjs";
import { HeldoutViolation, freezeCandidate, listManifests, loadManifest, readEntries, report } from "./index.mjs";
import { loadSplit } from "./split.mjs";

function value(argv, flag, fallback) {
	return argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
}

function showReport(freezeId) {
	const summary = report(freezeId);
	const manifest = loadManifest(freezeId);
	console.log(`freeze ${freezeId}${manifest.label ? ` (${manifest.label})` : ""}`);
	console.log(`  candidate: ${manifest.candidate.package}@${manifest.candidate.version} src=${manifest.candidate.sourceHash.slice(0, 12)}`);
	console.log(`  model:     ${manifest.candidate.model}`);
	console.log(`  eval set:  ${manifest.split.heldout.dataset} — ${manifest.split.heldout.tasks.length} tasks`);
	console.log(`  attempts:  ${summary.attempts}`);
	const perSolved = summary.solved === 0 ? "n/a" : (summary.cost / summary.solved).toFixed(4);
	console.log(`  solved:    ${summary.solved}/${summary.tasks}`);
	console.log(`  tokens:    ${summary.tokens}`);
	console.log(`  cost:      $${summary.cost.toFixed(4)} (per solved: $${perSolved})`);
}

const [command, ...argv] = process.argv.slice(2);

try {
	if (command === "freeze") {
		const manifest = freezeCandidate({ model: value(argv, "--model", DEFAULT_MODEL), label: value(argv, "--label", null) });
		console.log(`frozen ${manifest.freezeId}${manifest.label ? ` (${manifest.label})` : ""}`);
		console.log(`  candidate ${manifest.candidate.package}@${manifest.candidate.version} src=${manifest.candidate.sourceHash.slice(0, 12)}`);
		console.log(`  eval set  ${manifest.split.heldout.dataset} — ${manifest.split.heldout.tasks.length} tasks (split ${manifest.splitHash.slice(0, 12)})`);
	} else if (command === "status") {
		const manifests = listManifests();
		if (manifests.length === 0) console.log("no frozen candidates");
		for (const manifest of manifests) {
			const entries = readEntries().filter((entry) => entry.freezeId === manifest.freezeId);
			console.log(`${manifest.freezeId}  ${manifest.createdAt}  runs=${entries.length}  ${manifest.label ?? ""}`);
		}
	} else if (command === "verify") {
		const freezeId = value(argv, "--freeze-id", null) ?? listManifests().at(-1)?.freezeId;
		if (!freezeId) throw new Error("no frozen candidates");
		const manifest = loadManifest(freezeId);
		assertSplitFrozen(manifest, loadSplit());
		assertFrozenMatches(manifest, describeCandidate());
		console.log(`freeze ${freezeId} is valid — candidate and eval set unchanged`);
	} else if (command === "report") {
		const freezeId = value(argv, "--freeze-id", null);
		for (const id of freezeId ? [freezeId] : listManifests().map((manifest) => manifest.freezeId)) showReport(id);
	} else {
		console.log("usage: cli.mjs <freeze|verify|status|report> [--label ...] [--model ...] [--freeze-id ...]");
		process.exit(command ? 1 : 0);
	}
} catch (error) {
	if (error instanceof HeldoutViolation) {
		console.error(`held-out violation: ${error.message}`);
		process.exit(2);
	}
	throw error;
}
