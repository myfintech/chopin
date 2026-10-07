import { describe, expect, it } from "bun:test";

import { blocks, diff } from "./blocks";

function changes(before: string, after: string) {
	return diff(blocks(before), blocks(after), 4, 5).map(change => ({
		kind: change.kind,
		before: change.before?.source.trim(),
		after: change.after?.source.trim(),
		beforeIndex: change.before?.index,
		afterIndex: change.after?.index,
	}));
}

describe("document provenance blocks", () => {
	it("splits canonical MDX into digested top-level blocks", () => {
		let found = blocks("# Title\n\nHello **world**.\n\n- a\n- b\n");
		expect(found.map(block => block.source)).toEqual([
			"# Title\n",
			"Hello **world**.\n",
			"- a\n- b\n",
		]);
		expect(found.map(block => block.index)).toEqual([0, 1, 2]);
		expect(found[0]!.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("records a few changed words as one modified block with its full before and after", () => {
		let base = "# Plan\n\nThe service retries failed jobs three times before giving up.\n\nTail.\n";
		let next =
			"# Plan\n\nThe service retries failed requests five times before alerting.\n\nTail.\n";
		expect(changes(base, next)).toEqual([{
			kind: "modified",
			before: "The service retries failed jobs three times before giving up.",
			after: "The service retries failed requests five times before alerting.",
			beforeIndex: 1,
			afterIndex: 1,
		}]);
	});

	it("carries the revisions it was asked to stamp", () => {
		let [change] = diff(blocks("A.\n"), blocks("B.\n"), 7, 8);
		expect(change).toMatchObject({ fromRevision: 7, toRevision: 8 });
	});

	it("records insertion and removal without touching unchanged neighbours", () => {
		expect(changes("One.\n\nThree.\n", "One.\n\nTwo.\n\nThree.\n")).toEqual([
			{ kind: "added", before: undefined, after: "Two.", beforeIndex: undefined, afterIndex: 1 },
		]);
		expect(changes("One.\n\nTwo.\n\nThree.\n", "One.\n\nThree.\n")).toEqual([
			{ kind: "removed", before: "Two.", after: undefined, beforeIndex: 1, afterIndex: undefined },
		]);
	});

	it("records a verbatim relocation as a move", () => {
		expect(changes("Alpha.\n\nBeta.\n\nGamma.\n", "Beta.\n\nGamma.\n\nAlpha.\n")).toEqual([
			{ kind: "moved", before: "Alpha.", after: "Alpha.", beforeIndex: 0, afterIndex: 2 },
		]);
	});

	it("does not read a new paragraph above an edited one as a rewrite of it", () => {
		let base = "Intro.\n\nThe quick brown fox jumps over the lazy dog.\n\nEnd.\n";
		let next =
			"Intro.\n\nA brand new unrelated paragraph.\n\nThe quick brown fox leaps over the lazy dog.\n\nEnd.\n";
		expect(changes(base, next)).toEqual([
			{
				kind: "added",
				before: undefined,
				after: "A brand new unrelated paragraph.",
				beforeIndex: undefined,
				afterIndex: 1,
			},
			{
				kind: "modified",
				before: "The quick brown fox jumps over the lazy dog.",
				after: "The quick brown fox leaps over the lazy dog.",
				beforeIndex: 1,
				afterIndex: 2,
			},
		]);
	});

	it("still records every block of a rewrite too large to align", () => {
		let base = Array.from({ length: 600 }, (_, index) => `Old ${index}.`).join("\n\n");
		let next = Array.from({ length: 600 }, (_, index) => `New ${index}.`).join("\n\n");
		let found = diff(blocks(base), blocks(next), 0, 1);
		expect(found).toHaveLength(600);
		expect(found.every(change => change.kind === "modified")).toBe(true);
	});
});
