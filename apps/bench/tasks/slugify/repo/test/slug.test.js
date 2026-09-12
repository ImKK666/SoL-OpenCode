import assert from "node:assert/strict";
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
