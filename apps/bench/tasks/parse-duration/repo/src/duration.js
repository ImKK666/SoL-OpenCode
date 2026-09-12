export function parseDuration(input) {
	const hours = Number(/(\d+)h/.exec(input)?.[1] ?? 0);
	const minutes = Number(/(\d+)m/.exec(input)?.[1] ?? 0);
	const seconds = Number(/(\d+)s/.exec(input)?.[1] ?? 0);
	return hours * 60 + minutes * 60 + seconds;
}
