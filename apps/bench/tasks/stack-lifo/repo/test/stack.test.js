import assert from "node:assert/strict";
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
