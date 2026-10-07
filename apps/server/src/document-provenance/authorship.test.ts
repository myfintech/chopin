import { describe, expect, it } from "bun:test";

import { attribute, author } from "./authorship";
import { blocks, diff } from "./blocks";
import { MemoryProvenanceStore } from "./memory";

import type { Actor, Via } from "./model";

const ALICE: Actor = { type: "human", kind: "user", id: "U_alice", handle: "alice" };
const BOB: Actor = { type: "human", kind: "user", id: "U_bob", handle: "bob" };
const PLANNER_FOR_ALICE: Actor = {
	type: "agent",
	kind: "planner",
	requestedBy: { id: "U_alice", handle: "alice" },
};
const PLANNER_FOR_BOB: Actor = {
	type: "agent",
	kind: "planner",
	requestedBy: { id: "U_bob", handle: "bob" },
};
const START = Date.parse("2026-10-04T12:00:00.000Z");

/** Record a sequence of documents, each written by one actor a minute after the last. */
async function history(steps: Array<[Actor, string, Via?]>) {
	let store = new MemoryProvenanceStore();
	let source = "";
	for (let [index, [actor, next, via]] of steps.entries()) {
		let revision = index + 1;
		let after = blocks(next);
		store.record("C", {
			actor,
			via: via ?? "browser",
			fromRevision: revision - 1,
			toRevision: revision,
			blocks: diff(blocks(source), after, revision - 1, revision),
			afterDigests: after.map(block => block.digest),
		}, new Date(START + index * 60_000));
		source = next;
	}
	let { entries } = await store.list("C", 500);
	return attribute(entries, blocks(source));
}

describe("document authorship", () => {
	it("credits each block to its latest writer and keeps who asked an agent", async () => {
		let found = await history([
			[ALICE, "# Retries\n\nRetry jobs three times.\n"],
			[PLANNER_FOR_ALICE, "# Retries\n\nRetry requests five times.\n"],
		]);
		expect(found.blocks[0]!.author).toEqual({
			type: "human",
			key: "human:U_alice",
			handle: "alice",
		});
		expect(found.blocks[1]!.author).toEqual({
			type: "agent",
			key: "agent:planner",
			kind: "planner",
			name: "Planner",
			for: "alice",
		});
		expect(found.blocks[1]!.contributors).toBe(2);
		expect(found.blocks[1]!.history.map(item => [item.author.key, item.kind])).toEqual([
			["agent:planner", "modified"],
			["human:U_alice", "added"],
		]);
		expect(found.blocks[1]).toMatchObject({
			before: "Retry jobs three times.\n",
			after: "Retry requests five times.\n",
			restorable: true,
			restore: "Retry jobs three times.\n",
		});
		expect(found.blocks[0]!.restorable).toBe(false);
	});

	it("treats one agent as one author whoever asked it", async () => {
		let found = await history([
			[PLANNER_FOR_ALICE, "First.\n"],
			[PLANNER_FOR_BOB, "First.\n\nSecond paragraph here.\n"],
		]);
		expect(found.blocks.map(block => block.author?.key)).toEqual([
			"agent:planner",
			"agent:planner",
		]);
		expect(found.blocks.map(block => block.author?.type === "agent" && block.author.for)).toEqual([
			"alice",
			"bob",
		]);
		expect(found.contributors).toHaveLength(1);
		expect(found.contributors[0]).toMatchObject({ blocks: 2 });
	});

	it("does not credit a move to the person who moved the block", async () => {
		let found = await history([
			[ALICE, "Alpha paragraph.\n\nBeta paragraph.\n"],
			[BOB, "Beta paragraph.\n\nAlpha paragraph.\n"],
		]);
		let alpha = found.blocks.find(block => block.index === 1)!;
		expect(alpha.author?.key).toBe("human:U_alice");
		expect(alpha.history.map(item => item.kind)).toEqual(["moved", "added"]);
		expect(alpha.contributors).toBe(1);
	});

	it("follows a block through another author's edit and back", async () => {
		let found = await history([
			[ALICE, "Retry once.\n"],
			[PLANNER_FOR_ALICE, "Retry twice.\n"],
			[BOB, "Retry three times.\n"],
		]);
		let [only] = found.blocks;
		expect(only!.author?.key).toBe("human:U_bob");
		expect(only!.contributors).toBe(3);
		expect(only!.restore).toBe("Retry twice.\n");
	});

	it("leaves unrecorded text unattributed and counts it apart", async () => {
		let store = new MemoryProvenanceStore();
		let found = attribute((await store.list("C", 10)).entries, blocks("Older text.\n"));
		expect(found.blocks[0]!.author).toBeUndefined();
		expect(found.untracked).toBe("Older text.\n".length);
		expect(found.contributors).toEqual([]);
	});

	it("never offers to restore a decision projection", async () => {
		let found = await history([
			[ALICE, "<Callout>One.</Callout>\n"],
			[BOB, "<Callout>Two.</Callout>\n"],
		]);
		expect(found.blocks[0]!.author?.key).toBe("human:U_bob");
		expect(found.blocks[0]!.restorable).toBe(false);
		expect(found.blocks[0]!.restore).toBeUndefined();
	});

	it("tells agents of one kind apart only when they carry an id", () => {
		expect(author({ type: "agent", kind: "planner", id: "reviewer", name: "Reviewer" })).toEqual({
			type: "agent",
			key: "agent:planner:reviewer",
			kind: "planner",
			name: "Reviewer",
		});
		expect(
			author({
				type: "agent",
				kind: "coding-agent",
				user: { handle: "alice" },
				client: { name: "Claude Code", version: "2.1" },
			}),
		).toMatchObject({ key: "agent:coding-agent:Claude Code", name: "Claude Code", for: "alice" });
	});
});
