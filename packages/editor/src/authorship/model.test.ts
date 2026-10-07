import { describe, expect, it } from "bun:test";

import { agentShare, authorColor, contribution, marks, onBehalf, shares, when } from "./model";

import type { Provenance } from "@chopin/protocol";

const ALICE: Provenance.Author = { type: "human", key: "human:U_alice", handle: "alice" };
const PLANNER = (asker: string): Provenance.Author => ({
	type: "agent",
	key: "agent:planner",
	kind: "planner",
	name: "Planner",
	for: asker,
});

function block(index: number, author?: Provenance.Author, contributors = 1): Provenance.Block {
	return {
		anchor: { epoch: "E", position: "", digest: `d${index}` },
		index,
		...(author ? { author } : {}),
		contributors,
		history: [],
		restorable: false,
	};
}

describe("authorship marks", () => {
	it("shows a face where a run of one author for one requester starts", () => {
		let drawn = marks([
			block(0, ALICE),
			block(1, ALICE),
			block(2, PLANNER("alice")),
			block(3, PLANNER("alice"), 2),
			block(4, PLANNER("bob")),
			block(5),
		], undefined);
		expect(drawn.map(mark => mark.face)).toEqual([true, false, true, false, true, false]);
		expect(drawn.map(mark => mark.texture)).toEqual([
			"solid",
			"solid",
			"dashed",
			"dashed",
			"dashed",
			"faint",
		]);
		expect(drawn[3]!.multi).toBe(true);
	});

	it("starts a new run across a block the server could not anchor", () => {
		let drawn = marks([block(0, ALICE), block(2, ALICE)], undefined);
		expect(drawn.map(mark => mark.face)).toEqual([true, true]);
	});

	it("dims everything but the focused author, or every agent", () => {
		let blocks = [block(0, ALICE), block(1, PLANNER("alice")), block(2)];
		expect(marks(blocks, "human:U_alice").map(mark => mark.dimmed)).toEqual([false, true, true]);
		expect(marks(blocks, "agents").map(mark => mark.dimmed)).toEqual([true, false, true]);
	});

	it("keeps the Planner in the product colour and a person in their cursor colour", () => {
		expect(authorColor(PLANNER("alice"))).toBe("var(--color-brand)");
		expect(authorColor(ALICE)).toMatch(/^#/);
	});

	it("says who an agent acted for", () => {
		expect(onBehalf(PLANNER("alice"))).toBe("Asked by @alice");
		expect(onBehalf(ALICE)).toBeUndefined();
	});

	it("divides the document between contributors and leaves untracked text out", () => {
		let reply = {
			kind: "provenance:authorship",
			ts: 0,
			epoch: "E",
			revision: 3,
			blocks: [],
			contributors: [
				{ author: ALICE, blocks: 2, characters: 60 },
				{ author: PLANNER("alice"), blocks: 1, characters: 30 },
			],
			untracked: 10,
		} satisfies Provenance.Authorship.Reply;
		expect(shares(reply).map(item => item.percent)).toEqual([60, 30]);
		expect(agentShare(reply)).toMatchObject({ blocks: 1, percent: 30 });
	});

	it("names a history row's requester and places it on the calendar", () => {
		expect(
			contribution({
				author: PLANNER("mkhan"),
				kind: "modified",
				at: "",
				fromRevision: 1,
				toRevision: 2,
			}),
		).toBe("Planner, for @mkhan, edited");
		let now = new Date(2026, 9, 6, 15, 0);
		expect(when(new Date(2026, 9, 6, 14, 41).toISOString(), now)).toMatch(/^Today /);
		expect(when(new Date(2026, 9, 5, 16, 5).toISOString(), now)).toMatch(/^Yesterday /);
		expect(when(new Date(2026, 8, 1, 9, 0).toISOString(), now)).not.toMatch(/Today|Yesterday/);
	});
});
