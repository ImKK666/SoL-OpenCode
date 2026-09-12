/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * The opencode.json overlay Harbor writes into the task container.
 *
 * Both arms get the same provider block (so the only variable is the plugin).
 * The catalogue is injected so this is testable without the user's model cache.
 */
import { TREATMENT_PLUGIN } from "../config.mjs";

/** Resolve the provider block for a `provider/model` id from a model catalogue. */
export function providerBlock(model, catalogue = {}) {
	const [providerId, modelId] = model.split("/");
	if (!providerId || !modelId) throw new Error(`model must be provider/model, got ${model}`);
	const entry = catalogue[providerId] ?? {};
	const block = { models: { [modelId]: {} } };
	if (entry.npm) block.npm = entry.npm;
	const baseURL = entry.api ?? entry.options?.baseURL;
	if (baseURL) block.options = { baseURL };
	return { providerId, block };
}

/** Control = provider only. Treatment = provider + the pinned plugin artifact. */
export function opencodeConfig(arm, model, catalogue, pluginSpec) {
	const { providerId, block } = providerBlock(model, catalogue);
	const config = { provider: { [providerId]: block } };
	if (arm === "treatment") {
		if (!pluginSpec) throw new Error("treatment arm needs the frozen plugin spec");
		config.plugin = [[pluginSpec, TREATMENT_PLUGIN]];
	}
	return config;
}
