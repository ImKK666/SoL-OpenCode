/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * The candidate under test, and its identity.
 *
 * A frozen evaluation is only meaningful if you can prove *what* ran. The
 * candidate therefore pins the plugin version AND a hash of the plugin/core
 * source trees, so editing the mechanisms after a freeze invalidates the run
 * instead of silently changing the result.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_MODEL, PLUGIN_DIR, TREATMENT_PLUGIN, pluginPackage } from "../config.mjs";

const CORE_DIR = join(PLUGIN_DIR, "..", "core");

/** Deterministic JSON: object keys sorted, so hashes are stable. */
export function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function hashValue(value) {
	return createHash("sha256").update(canonical(value)).digest("hex");
}

function walk(dir, acc = []) {
	if (!existsSync(dir)) return acc;
	const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (["node_modules", "dist", "test", "tests"].includes(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, acc);
		else if (/\.(ts|mts|js|mjs|json)$/.test(entry.name)) acc.push(path);
	}
	return acc;
}

/** Hash the mechanism source itself, not just the declared version. */
export function sourceHash() {
	const files = [...walk(join(PLUGIN_DIR, "src")), ...walk(join(CORE_DIR, "src"))].sort();
	const digest = createHash("sha256");
	for (const file of files) {
		digest.update(file.replace(/^.*[/\\]packages[/\\]/, ""));
		digest.update("\0");
		digest.update(readFileSync(file));
		digest.update("\0");
	}
	return digest.digest("hex");
}

export function describeCandidate({ model = DEFAULT_MODEL, mechanisms = TREATMENT_PLUGIN } = {}) {
	const pkg = pluginPackage();
	return {
		package: pkg.name,
		version: pkg.version,
		// The exact artifact the container installs — pinned so the ledger names
		// what actually ran, not just "whatever is on npm today".
		pluginSpec: `${pkg.name}@${pkg.version}`,
		sourceHash: sourceHash(),
		model,
		mechanisms,
	};
}

export function candidateHash(candidate) {
	return hashValue(candidate);
}
