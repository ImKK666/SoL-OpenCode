export function sumRange(low, high) {
	let total = 0;
	for (let value = low; value < high; value += 1) total += value;
	return total;
}
