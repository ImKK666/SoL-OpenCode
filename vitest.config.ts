import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Only the package test suites, plus the benchmark's held-out
		// discipline. The e2e fixtures under apps/ are intentionally broken
		// and are run by the e2e harness, not vitest.
		include: ["packages/*/test/**/*.test.ts", "apps/bench/**/*.test.mjs"],
	},
});
