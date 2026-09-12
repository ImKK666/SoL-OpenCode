import assert from "node:assert/strict";
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
