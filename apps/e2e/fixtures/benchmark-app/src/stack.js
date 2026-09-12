// A LIFO stack. NOTE: this baseline intentionally contains a bug for the
// benchmark task; do not fix it here.
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
		return this.#items[this.#items.length - 1];
	}

	get size() {
		return this.#items.length;
	}

	isEmpty() {
		return this.#items.length === 0;
	}
}
