export class Stack {
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
