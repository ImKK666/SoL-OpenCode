import assert from "node:assert/strict";
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
