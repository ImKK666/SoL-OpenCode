import assert from "node:assert/strict";
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
