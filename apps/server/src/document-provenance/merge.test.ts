import { describe, expect, it } from "bun:test";

import { blocks, diff } from "./blocks";
import { actorKey, entry, extend, IDLE_MS, SPAN_MS } from "./merge";

import type { Actor, ProvenanceChange, Via } from "./model";

const ALICE: Actor = { type: "human", kind: "user", id: "U_alice", handle: "alice" };
const BOB: Actor = { type: "human", kind: "user", id: "U_bob", handle: "bob" };
const START = new Date("2026-10-04T12:00:00.000Z");

function change(
	before: string,
	after: string,
	revision: number,
	actor: Actor = ALICE,
	via: Via = "browser",
): ProvenanceChange {
	let next = blocks(after);
	return {
		actor,
		via,
		fromRevision: revision - 1,
		toRevision: revision,
		blocks: diff(blocks(before), next, revision - 1, revision),
		afterDigests: next.map(block => block.digest),
	};
}

function later(ms: number): Date {
	return new Date(START.getTime() + ms);
}

describe("document provenance coalescing", () => {
	it("folds an actor's keystrokes in one block into a single before and latest after", () => {
		let open = entry("C", change("Hello.\n\nTail.\n", "Hello w.\n\nTail.\n", 1), START);
		let merged = extend(
			open,
			change("Hello w.\n\nTail.\n", "Hello world.\n\nTail.\n", 2),
			later(500),
		);
		expect(merged).toBeDefined();
		expect(merged!.fromRevision).toBe(0);
		expect(merged!.toRevision).toBe(2);
		expect(merged!.endedAt).toEqual(later(500));
		expect(merged!.blocks).toHaveLength(1);
		expect(merged!.blocks[0]).toMatchObject({
			kind: "modified",
			fromRevision: 0,
			toRevision: 2,
			before: { source: "Hello.\n", index: 0 },
			after: { source: "Hello world.\n", index: 0 },
		});
	});

	it("starts a new entry after the idle window, the span limit, or for another route", () => {
		let open = entry("C", change("A.\n", "B.\n", 1), START);
		expect(extend(open, change("B.\n", "C.\n", 2), later(IDLE_MS + 1))).toBeUndefined();
		let long = { ...open, endedAt: later(SPAN_MS) };
		expect(extend(long, change("B.\n", "C.\n", 2), later(SPAN_MS + 1))).toBeUndefined();
		expect(extend(open, change("B.\n", "C.\n", 2, ALICE, "server"), later(1))).toBeUndefined();
		expect(extend(open, change("B.\n", "C.\n", 2, BOB), later(1))).toBeUndefined();
	});

	it("drops a block the actor added and then removed again", () => {
		let open = entry("C", change("A.\n", "A.\n\nDraft.\n", 1), START);
		let merged = extend(open, change("A.\n\nDraft.\n", "A.\n", 2), later(1));
		expect(merged!.blocks).toEqual([]);
	});

	it("keeps another author's intervening edit out of the actor's merged block", () => {
		let open = entry("C", change("Shared text.\n", "Shared text, Alice.\n", 1), START);
		// Bob changes the same block in revision 2; Alice edits it again in revision 3.
		let merged = extend(
			open,
			change("Shared text, Alice and Bob.\n", "Shared text, Alice and Bob!\n", 3),
			later(1),
		);
		expect(merged!.blocks.map(block => [block.fromRevision, block.toRevision])).toEqual([
			[0, 1],
			[2, 3],
		]);
		expect(merged!.blocks[0]!.after!.source).toBe("Shared text, Alice.\n");
		expect(merged!.blocks[1]!.before!.source).toBe("Shared text, Alice and Bob.\n");
	});

	it("keeps coalesced block positions current when other blocks shift", () => {
		let open = entry("C", change("One.\n\nTwo.\n", "One.\n\nTwo!\n", 1), START);
		let merged = extend(open, change("One.\n\nTwo!\n", "Zero.\n\nOne.\n\nTwo!\n", 2), later(1));
		let edited = merged!.blocks.find(block => block.kind === "modified");
		expect(edited!.after!.index).toBe(2);
		expect(merged!.blocks.find(block => block.kind === "added")!.after!.source).toBe("Zero.\n");
	});

	it("separates Planner work by requester and coding agents by user", () => {
		expect(actorKey({ type: "agent", kind: "planner", requestedBy: { handle: "a", id: "U_a" } }))
			.not.toBe(actorKey({ type: "agent", kind: "planner", requestedBy: { handle: "b" } }));
		expect(actorKey({ type: "agent", kind: "coding-agent", user: { id: "U_a", handle: "a" } }))
			.toBe("agent:coding-agent:U_a:");
		expect(entry("C", change("A.\n", "B.\n", 1, ALICE), START).authorType).toBe("human");
	});
});
