/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// Storage root: XDG-style user data directory, keyed by project then session.
// We own this root because OpenCode exposes no verified session-directory API.
//
//   <SOL_OPENCODE_HOME or ~/.local/share/sol-opencode>/<project-slug>/<session-id>/

export function solHome(): string {
	const override = process.env["SOL_OPENCODE_HOME"];
	if (typeof override === "string" && override.length > 0) return override;
	return join(homedir(), ".local", "share", "sol-opencode");
}

function sanitize(value: string): string {
	return (
		value
			.replace(/[^a-zA-Z0-9._-]+/gu, "-")
			.replace(/^-+|-+$/gu, "")
			.slice(0, 40) || "project"
	);
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function projectSlug(directory: string): string {
	return `${sanitize(basename(directory))}-${shortHash(directory)}`;
}

export function sessionRoot(directory: string, sessionID: string): string {
	return join(solHome(), projectSlug(directory), sanitize(sessionID));
}
