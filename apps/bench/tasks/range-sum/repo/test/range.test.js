import assert from "node:assert/strict";
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
