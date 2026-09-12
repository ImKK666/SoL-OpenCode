/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import type { Hooks, Plugin } from "@opencode-ai/plugin";
import { parseConfig } from "./config.ts";
import { HookBus, createKernel } from "./kernel.ts";
import { registerActionFusion } from "./mechanisms/action-fusion.ts";
import { registerObservationPack } from "./mechanisms/observation-pack.ts";
import { registerOnlineContextCompact } from "./mechanisms/online-context-compact.ts";
import { registerReducer } from "./mechanisms/reducer.ts";
import { registerTrajectory } from "./mechanisms/trajectory.ts";

/**
 * SoL-OpenCode plugin entry point.
 *
 * All mechanisms are opt-in and default off. Enable them through OpenCode's
 * plugin options:
 *
 *   "plugin": [["@alicekk/sol-opencode", {
 *     "trajectoryInspector": { "enabled": true },
 *     "actionFusion": { "enabled": true },
 *     "observationPack": { "enabled": true },
 *     "evidencePreservingReducer": { "enabled": true },
 *     "onlineContextCompact": { "enabled": true }
 *   }]]
 *
 * Registration order matters: the reducer runs before ObservationPack so that
 * its (small) receipts are never packed.
 */
export const SolOpenCodePlugin: Plugin = async (input, options): Promise<Hooks> => {
	const config = parseConfig(options);
	const kernel = createKernel(input, config);
	const bus = new HookBus();

	if (config.trajectoryInspector.enabled) {
		registerTrajectory(kernel, bus);
	}
	if (config.actionFusion.enabled) {
		registerActionFusion(kernel, bus);
	}
	if (config.evidencePreservingReducer.enabled) {
		registerReducer(kernel, bus);
	}
	if (config.observationPack.enabled) {
		registerObservationPack(kernel, bus);
	}
	if (config.onlineContextCompact.enabled) {
		registerOnlineContextCompact(kernel, bus);
	}

	return bus.build((error) => {
		kernel.log(error instanceof Error ? error.message : String(error));
	});
};

export default SolOpenCodePlugin;
