/**
 * What changed between two versions of a block, word by word.
 *
 * Computed when a reader opens a block's card rather than stored, so the way
 * changes are shown can improve without rewriting recorded history.
 */

export type Piece = { kind: "same" | "added" | "removed"; text: string };

/** Beyond this many word comparisons the change is shown as a whole replacement. */
const LIMIT = 200_000;

function tokens(source: string): string[] {
	return source.match(/\s+|[^\s]+/g) ?? [];
}

function push(out: Piece[], kind: Piece["kind"], text: string): void {
	let last = out.at(-1);
	if (last?.kind === kind) last.text += text;
	else out.push({ kind, text });
}

export function words(before: string, after: string): Piece[] {
	let left = tokens(before.trimEnd());
	let right = tokens(after.trimEnd());
	let out: Piece[] = [];
	if (left.length * right.length > LIMIT) {
		if (left.length) push(out, "removed", left.join(""));
		if (right.length) push(out, "added", right.join(""));
		return out;
	}

	let width = right.length + 1;
	let table = new Uint32Array((left.length + 1) * width);
	for (let i = left.length - 1; i >= 0; i--) {
		for (let j = right.length - 1; j >= 0; j--) {
			table[i * width + j] = left[i] === right[j]
				? table[(i + 1) * width + j + 1]! + 1
				: Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
		}
	}

	let i = 0;
	let j = 0;
	while (i < left.length || j < right.length) {
		if (i < left.length && j < right.length && left[i] === right[j]) {
			push(out, "same", left[i]!);
			i++;
			j++;
		} else if (
			j >= right.length
			|| (i < left.length && table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
		) {
			push(out, "removed", left[i]!);
			i++;
		} else {
			push(out, "added", right[j]!);
			j++;
		}
	}
	return out;
}
