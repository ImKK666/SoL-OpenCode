export function chunk(values, size) {
	const out = [];
	for (let index = 0; index < values.length - size; index += size) {
		out.push(values.slice(index, index + size));
	}
	return out;
}
