/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Deterministic e2e scenarios. Each scenario scripts the mock's assistant turns
 * so a run is reproducible, and names the plugin options that turn on the single
 * mechanism under test.
 */

const BIG_OUTPUT = `node -e "process.stdout.write('z'.repeat(20000))"`;

const LONG_FAIL_CMD = `make 2>&1; node -e "for(let i=0;i<400;i++)console.log('error: fake failure '+i+' '+'x'.repeat(20))"; exit 1`;

export const scenarios = {
	baseline: {
		description: "No tools; a single assistant turn. Harness smoke test.",
		prompt: "say hi",
		model: "mock-1",
		script: { "*": ["hello there"] },
		plugin: {},
	},

	"observation-pack": {
		description: "One ~20 KiB tool result followed by cheap tool calls: the result is replayed until ObservationPack replaces it with a placeholder.",
		prompt: "please run the big command",
		model: "mock-1",
		script: {
			"big command": [
				[{ name: "bash", args: { command: BIG_OUTPUT } }],
				[{ name: "bash", args: { command: "echo tick-1" } }],
				[{ name: "bash", args: { command: "echo tick-2" } }],
				[{ name: "bash", args: { command: "echo tick-3" } }],
				[{ name: "bash", args: { command: "echo tick-4" } }],
				"done",
			],
		},
		plugin: { observationPack: { enabled: true, thresholdBytes: 10240, fullSends: 2 } },
	},

	"action-fusion": {
		description:
			"An edit carrying then_run. With fusion the follow-up runs in the same tool call; without it the agent has to issue a separate validation turn (modelled by the conditional step).",
		prompt: "edit the demo file",
		model: "mock-1",
		script: {
			"edit the demo file": [
				[
					{
						name: "edit",
						args: {
							filePath: "demo.txt",
							oldString: "hello",
							newString: "hello world",
							then_run: { command: "cat demo.txt" },
						},
					},
				],
				{
					conditional: true,
					ifFused: "validation was included",
					ifNotFused: [{ name: "bash", args: { command: "cat demo.txt" } }],
				},
				"done",
			],
		},
		setupFiles: { "demo.txt": "hello\n" },
		plugin: { actionFusion: { enabled: true, tools: ["edit", "write"] } },
	},

	reducer: {
		description:
			"A long failing build log is reduced to a verified receipt over a child-session model call; the mock answers that child session with a receipt built from the request.",
		prompt: "build the project",
		model: "mock-1",
		script: {
			"build the project": [
				[{ name: "bash", args: { command: LONG_FAIL_CMD } }],
				[{ name: "bash", args: { command: "echo tick-1" } }],
				[{ name: "bash", args: { command: "echo tick-2" } }],
				"done",
			],
		},
		plugin: { evidencePreservingReducer: { enabled: true, provider: "mock", model: "mock-1" } },
	},
};
