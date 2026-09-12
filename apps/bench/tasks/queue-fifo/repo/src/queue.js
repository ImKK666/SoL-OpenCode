export class Queue {
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
