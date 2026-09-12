/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 ImKK666. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Generates the verifier-driven task suite for the benchmark.
 *
 * Each task is a self-contained Node project with one deliberate bug and an
 * executable verifier (`npm test`) that FAILS before the fix and PASSES after
 * it — the same fail-before/pass-after contract upstream SoL-Pi uses to keep a
 * task, its verifier, and its ground truth consistent.
 *
 * Usage: node apps/bench/generate.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "tasks");

const pkg = (name) =>
	JSON.stringify({ name, private: true, type: "module", scripts: { test: "node --test" } }, null, 2) + "\n";

const FIX_SUFFIX =
	" Some tests fail. Find and fix the bug in the source file so that every test passes. Verify by running `npm test`.";

const tasks = [
	{
		id: "stack-lifo",
		module: "stack",
		prompt: "Run `npm test`." + FIX_SUFFIX,
		src: `export class Stack {
	#items = [];

	push(value) {
		this.#items.push(value);
		return this;
	}

	pop() {
		return this.#items.shift();
	}

	peek() {
		return this.#items.at(-1);
	}

	get size() {
		return this.#items.length;
	}

	isEmpty() {
		return this.#items.length === 0;
	}
}
`,
		test: `import assert from "node:assert/strict";
import { test } from "node:test";
import { Stack } from "../src/stack.js";

test("push grows the stack", () => {
	const stack = new Stack();
	stack.push(1);
	stack.push(2);
	assert.equal(stack.size, 2);
});

test("peek does not remove", () => {
	const stack = new Stack();
	stack.push(10);
	assert.equal(stack.peek(), 10);
	assert.equal(stack.size, 1);
});

for (let width = 1; width <= 120; width += 1) {
	test("pops values in LIFO order (width " + width + ")", () => {
		const stack = new Stack();
		for (let value = 0; value < width; value += 1) stack.push(value);
		for (let value = width - 1; value >= 0; value -= 1) {
			assert.equal(stack.pop(), value, "expected " + value);
		}
		assert.equal(stack.isEmpty(), true);
	});
}
`,
	},
	{
		id: "queue-fifo",
		module: "queue",
		prompt: "Run `npm test`." + FIX_SUFFIX,
		src: `export class Queue {
	#items = [];

	enqueue(value) {
		this.#items.push(value);
		return this;
	}

	dequeue() {
		return this.#items.pop();
	}

	peek() {
		return this.#items[0];
	}

	get size() {
		return this.#items.length;
	}

	isEmpty() {
		return this.#items.length === 0;
	}
}
`,
		test: `import assert from "node:assert/strict";
import { test } from "node:test";
import { Queue } from "../src/queue.js";

test("enqueue grows the queue", () => {
	const queue = new Queue();
	queue.enqueue("a");
	queue.enqueue("b");
	assert.equal(queue.size, 2);
});

test("peek does not remove", () => {
	const queue = new Queue();
	queue.enqueue("x");
	assert.equal(queue.peek(), "x");
	assert.equal(queue.size, 1);
});

for (let width = 1; width <= 120; width += 1) {
	test("dequeues values in FIFO order (width " + width + ")", () => {
		const queue = new Queue();
		for (let value = 0; value < width; value += 1) queue.enqueue(value);
		for (let value = 0; value < width; value += 1) {
			assert.equal(queue.dequeue(), value, "expected " + value);
		}
		assert.equal(queue.isEmpty(), true);
	});
}
`,
	},
	{
		id: "range-sum",
		module: "range",
		prompt: "Run `npm test`." + FIX_SUFFIX,
		src: `export function sumRange(low, high) {
	let total = 0;
	for (let value = low; value < high; value += 1) total += value;
	return total;
}
`,
		test: `import assert from "node:assert/strict";
import { test } from "node:test";
import { sumRange } from "../src/range.js";

test("sums an inclusive single value", () => {
	assert.equal(sumRange(4, 4), 4);
});

for (let high = 1; high <= 120; high += 1) {
	test("sums every integer from 0 to " + high, () => {
		const expected = (high * (high + 1)) / 2;
		assert.equal(sumRange(0, high), expected, "inclusive upper bound " + high);
	});
}

for (let low = 1; low <= 60; low += 1) {
	test("sums a shifted range from " + low + " to " + (low + 30), () => {
		let expected = 0;
		for (let value = low; value <= low + 30; value += 1) expected += value;
		assert.equal(sumRange(low, low + 30), expected);
	});
}
`,
	},
	{
		id: "slugify",
		module: "slug",
		prompt: "Run `npm test`." + FIX_SUFFIX,
		src: `export function slugify(text) {
	return text.trim();
}
`,
		test: `import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slug.js";

const cases = [
	["Hello World", "hello-world"],
	["  Trim Me  ", "trim-me"],
	["Already-slugged", "already-slugged"],
	["Multiple   Spaces", "multiple-spaces"],
	["Punctuation! Here?", "punctuation-here"],
	["MiXeD CaSe", "mixed-case"],
];

for (const [input, expected] of cases) {
	test("slugifies " + JSON.stringify(input), () => {
		assert.equal(slugify(input), expected);
	});
}

for (let index = 0; index < 60; index += 1) {
	test("slugifies word pair " + index, () => {
		assert.equal(slugify("Word" + index + " More"), "word" + index + "-more");
	});
}
`,
	},
	{
		id: "parse-duration",
		module: "duration",
		prompt: "Run `npm test`." + FIX_SUFFIX,
		src: `export function parseDuration(input) {
	const hours = Number(/(\\d+)h/.exec(input)?.[1] ?? 0);
	const minutes = Number(/(\\d+)m/.exec(input)?.[1] ?? 0);
	const seconds = Number(/(\\d+)s/.exec(input)?.[1] ?? 0);
	return hours * 60 + minutes * 60 + seconds;
}
`,
		test: `import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "../src/duration.js";

test("parses seconds", () => {
	assert.equal(parseDuration("45s"), 45);
});

test("parses minutes", () => {
	assert.equal(parseDuration("2m"), 120);
});

test("parses hours", () => {
	assert.equal(parseDuration("1h"), 3600);
});

for (let hours = 0; hours <= 30; hours += 1) {
	test("parses " + hours + "h", () => {
		assert.equal(parseDuration(hours + "h"), hours * 3600);
	});
}

for (let minutes = 0; minutes <= 30; minutes += 1) {
	test("parses " + minutes + "m", () => {
		assert.equal(parseDuration(minutes + "m"), minutes * 60);
	});
}
`,
	},
	{
		id: "array-chunk",
		module: "chunk",
		prompt: "Run `npm test`." + FIX_SUFFIX,
		src: `export function chunk(values, size) {
	const out = [];
	for (let index = 0; index < values.length - size; index += size) {
		out.push(values.slice(index, index + size));
	}
	return out;
}
`,
		test: `import assert from "node:assert/strict";
import { test } from "node:test";
import { chunk } from "../src/chunk.js";

test("chunks evenly", () => {
	assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test("keeps the remainder", () => {
	assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

for (let size = 1; size <= 80; size += 1) {
	test("chunks 25 values into groups of " + size, () => {
		const values = Array.from({ length: 25 }, (_, index) => index);
		const groups = chunk(values, size);
		const rebuilt = groups.flat();
		assert.deepEqual(rebuilt, values, "chunking must keep every value");
		for (const group of groups.slice(0, -1)) {
			assert.equal(group.length, size, "all but the last group are full");
		}
	});
}
`,
	},
];

rmSync(OUT, { recursive: true, force: true });
for (const task of tasks) {
	const repo = join(OUT, task.id, "repo");
	mkdirSync(join(repo, "src"), { recursive: true });
	mkdirSync(join(repo, "test"), { recursive: true });
	writeFileSync(join(repo, "package.json"), pkg(task.id));
	writeFileSync(join(repo, "src", task.module + ".js"), task.src);
	writeFileSync(join(repo, "test", task.module + ".test.js"), task.test);
	writeFileSync(
		join(OUT, task.id, "task.json"),
		JSON.stringify({ id: task.id, prompt: task.prompt, test: "npm test" }, null, 2) + "\n",
	);
}
console.log("generated " + tasks.length + " tasks in " + OUT);
