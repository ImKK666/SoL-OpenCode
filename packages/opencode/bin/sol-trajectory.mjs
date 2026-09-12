#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

// Metadata-only trajectory viewer. Reads the JSONL written by the
// Trajectory Inspector; it never contacts OpenCode or the model.

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const EVENTS_FILE = join("trajectory-inspector", "events.jsonl");

function home() {
	return process.env.SOL_OPENCODE_HOME || join(homedir(), ".local", "share", "sol-opencode");
}

function resolveEventsPath(target) {
	if (!target) return undefined;
	if (target.endsWith(".jsonl") && existsSync(target)) return target;
	const candidate = join(target, EVENTS_FILE);
	return existsSync(candidate) ? candidate : undefined;
}

function formatLine(line) {
	const trimmed = line.trim();
	if (trimmed === "") return undefined;
	let entry;
	try {
		entry = JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
	const timestamp =
		typeof entry.timestamp === "number" ? new Date(entry.timestamp).toISOString().slice(11, 19) : "--:--:--";
	const status = String(entry.status ?? entry.event ?? "info").padEnd(7);
	const kind = String(entry.kind ?? "event").padEnd(8);
	const sequence = `#${entry.sequence ?? "?"}`;
	const label = entry.label ?? "";
	const detail = entry.detail ? ` · ${entry.detail}` : "";
	const duration = typeof entry.durationMs === "number" ? ` (${Math.round(entry.durationMs)}ms)` : "";
	return `${timestamp} ${status} ${kind} ${sequence} ${label}${detail}${duration}`;
}

async function show(path) {
	const text = await readFile(path, "utf8");
	for (const line of text.split("\n")) {
		const formatted = formatLine(line);
		if (formatted !== undefined) console.log(formatted);
	}
}

async function tail(path) {
	let position = 0;
	try {
		position = (await stat(path)).size;
	} catch {
		position = 0;
	}
	await show(path);
	process.stdout.write("--- following (ctrl-c to stop) ---\n");
	setInterval(async () => {
		try {
			const size = (await stat(path)).size;
			if (size <= position) return;
			const buffer = await readFile(path);
			const fresh = buffer
				.subarray(position)
				.toString("utf8")
				.split("\n")
				.map(formatLine)
				.filter((line) => line !== undefined);
			if (fresh.length > 0) process.stdout.write(`${fresh.join("\n")}\n`);
			position = size;
		} catch {
			// File may be rotated or removed; keep polling.
		}
	}, 500);
}

async function sessions(projectSlug) {
	const base = projectSlug ? join(home(), projectSlug) : home();
	let entries = [];
	try {
		entries = await readdir(base, { withFileTypes: true });
	} catch {
		console.error(`No SoL-OpenCode data at ${base}`);
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (projectSlug) {
			if (existsSync(join(base, entry.name, EVENTS_FILE))) console.log(join(base, entry.name));
		} else {
			console.log(entry.name);
		}
	}
}

const [command, target] = process.argv.slice(2);

if (command === "show" || command === "tail") {
	const eventsPath = resolveEventsPath(target);
	if (eventsPath === undefined) {
		console.error(`No events.jsonl found at ${target ?? "(missing path)"}`);
		process.exitCode = 1;
	} else if (command === "show") {
		await show(eventsPath);
	} else {
		await tail(eventsPath);
	}
} else if (command === "sessions") {
	await sessions(target);
} else {
	console.log("Usage: sol-trajectory <sessions [project-slug] | show <session-path> | tail <session-path>>");
}
