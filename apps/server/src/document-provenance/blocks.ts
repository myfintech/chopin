import { createHash } from "node:crypto";

import { parse, serialize } from "@chopin/dialect";

import type { RootContent } from "mdast";
import type { BlockChange, BlockState } from "./model";

/** Beyond this many middle-block comparisons, a rewrite is recorded without alignment. */
const ALIGNMENT_LIMIT = 250_000;
/** Word overlap at which an unequal gap pairs a removed and an added block as one edit. */
const SIMILARITY = 0.3;

/** Same digest as a room anchor, so later consumers can match blocks to anchors. */
export function digest(source: string): string {
	return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

/** Each top-level block of canonical MDX, in the anchor address space. */
export function blocks(source: string): BlockState[] {
	return parse(source).children.map((node: RootContent, index) => {
		let block = serialize({ type: "root", children: [node] });
		return { index, digest: digest(block), source: block };
	});
}

function words(source: string): Set<string> {
	return new Set(source.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function similarity(a: BlockState, b: BlockState): number {
	let left = words(a.source);
	let right = words(b.source);
	if (left.size === 0 && right.size === 0) return 1;
	let shared = 0;
	for (let word of left) if (right.has(word)) shared++;
	return shared / (left.size + right.size - shared);
}

/** Longest common subsequence of two digest runs, as index pairs. */
function align(before: BlockState[], after: BlockState[]): Array<[number, number]> {
	if (before.length * after.length > ALIGNMENT_LIMIT) return [];
	let width = after.length + 1;
	let table = new Uint32Array((before.length + 1) * width);
	for (let i = before.length - 1; i >= 0; i--) {
		for (let j = after.length - 1; j >= 0; j--) {
			table[i * width + j] = before[i]!.digest === after[j]!.digest
				? table[(i + 1) * width + j + 1]! + 1
				: Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
		}
	}
	let pairs: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < before.length && j < after.length) {
		if (before[i]!.digest === after[j]!.digest) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
		else j++;
	}
	return pairs;
}

/**
 * Which blocks changed between two canonical sources.
 *
 * Unchanged blocks align by digest. A block that left one place and appears
 * verbatim in another is a move. Inside each gap between aligned blocks, equal
 * counts pair in order as edits; unequal counts pair only blocks that still
 * share enough words, so a paragraph inserted above an edited one is not read
 * as a rewrite of it.
 */
export function diff(
	before: BlockState[],
	after: BlockState[],
	fromRevision: number,
	toRevision: number,
): BlockChange[] {
	let prefix = 0;
	while (
		prefix < before.length && prefix < after.length
		&& before[prefix]!.digest === after[prefix]!.digest
	) prefix++;
	let suffix = 0;
	while (
		suffix < before.length - prefix && suffix < after.length - prefix
		&& before[before.length - 1 - suffix]!.digest === after[after.length - 1 - suffix]!.digest
	) suffix++;
	let oldMiddle = before.slice(prefix, before.length - suffix);
	let newMiddle = after.slice(prefix, after.length - suffix);
	let matched = align(oldMiddle, newMiddle);

	// Gaps between aligned pairs, with a sentinel closing the last one.
	let gaps: Array<{ removed: BlockState[]; added: BlockState[] }> = [];
	let i = 0;
	let j = 0;
	for (let [left, right] of [...matched, [oldMiddle.length, newMiddle.length] as const]) {
		gaps.push({ removed: oldMiddle.slice(i, left), added: newMiddle.slice(j, right) });
		i = left + 1;
		j = right + 1;
	}

	let changes: BlockChange[] = [];
	let change = (
		kind: BlockChange["kind"],
		from?: BlockState,
		to?: BlockState,
	): BlockChange => ({
		kind,
		fromRevision,
		toRevision,
		...(from ? { before: from } : {}),
		...(to ? { after: to } : {}),
	});

	let moved = new Set<BlockState>();
	let arrivals = new Map<string, BlockState[]>();
	for (let gap of gaps) {
		for (let block of gap.added) {
			arrivals.set(block.digest, [...(arrivals.get(block.digest) ?? []), block]);
		}
	}
	for (let gap of gaps) {
		for (let block of gap.removed) {
			let destination = arrivals.get(block.digest)?.shift();
			if (!destination) continue;
			moved.add(block).add(destination);
			changes.push(change("moved", block, destination));
		}
	}

	for (let gap of gaps) {
		let removed = gap.removed.filter(block => !moved.has(block));
		let added = gap.added.filter(block => !moved.has(block));
		let paired = new Set<BlockState>();
		if (removed.length === added.length) {
			removed.forEach((block, index) => {
				changes.push(change("modified", block, added[index]));
				paired.add(block).add(added[index]!);
			});
		} else {
			let cursor = 0;
			for (let block of removed) {
				let best = -1;
				let score = SIMILARITY;
				for (let index = cursor; index < added.length; index++) {
					let value = similarity(block, added[index]!);
					if (value >= score) {
						best = index;
						score = value;
					}
				}
				if (best < 0) continue;
				changes.push(change("modified", block, added[best]));
				paired.add(block).add(added[best]!);
				cursor = best + 1;
			}
		}
		for (let block of removed) if (!paired.has(block)) changes.push(change("removed", block));
		for (let block of added) {
			if (!paired.has(block)) changes.push(change("added", undefined, block));
		}
	}

	return changes.sort((a, b) =>
		(a.after?.index ?? a.before!.index) - (b.after?.index ?? b.before!.index)
	);
}
