/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Shared benchmark configuration: the candidate under test.
 *
 * Both the dev harness (`bench.mjs`) and the held-out harness (`heldout/`)
 * read the candidate from here, so a freeze cannot drift from what actually
 * runs — see `heldout/candidate.mjs`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The plugin config that turns every mechanism on (the "treatment" arm). */
export const TREATMENT_PLUGIN = {
	trajectoryInspector: { enabled: true },
	actionFusion: { enabled: true },
	observationPack: { enabled: true },
	evidencePreservingReducer: { enabled: true, provider: "opencode-go", model: "deepseek-v4.1-flash" },
	onlineContextCompact: { enabled: true },
};

/** The control arm: plugin loaded but every mechanism off. */
export const CONTROL_PLUGIN = {
	trajectoryInspector: { enabled: false },
	actionFusion: { enabled: false },
	observationPack: { enabled: false },
	evidencePreservingReducer: { enabled: false },
	onlineContextCompact: { enabled: false },
};

export const ARMS = { control: CONTROL_PLUGIN, treatment: TREATMENT_PLUGIN };

export const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";

/** Solved tasks may not drop below the control arm by more than this. */
export const CAPABILITY_TOLERANCE = 0;

/** The plugin package under test (version is part of the frozen candidate). */
export function pluginPackage() {
	return JSON.parse(readFileSync(join(HERE, "../../packages/opencode/package.json"), "utf8"));
}

/** The opencode plugin entry point loaded from a source checkout. */
export const PLUGIN_DIR = join(HERE, "../../packages/opencode");
