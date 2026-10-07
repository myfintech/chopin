import { describe, expect, it } from "bun:test";

import { PostgresStorage } from "../storage/postgres/adapter";
import { blocks, diff } from "./blocks";

import type { Actor, ProvenanceChange } from "./model";

let url = process.env.TEST_DATABASE_URL;

const ALICE: Actor = { type: "human", kind: "user", id: "U_alice", handle: "alice" };
const PLANNER: Actor = { type: "agent", kind: "planner", requestedBy: { handle: "alice" } };

function change(before: string, after: string, revision: number, actor: Actor): ProvenanceChange {
	let next = blocks(after);
	return {
		actor,
		via: actor.type === "human" ? "browser" : "server",
		fromRevision: revision - 1,
		toRevision: revision,
		blocks: diff(blocks(before), next, revision - 1, revision),
		afterDigests: next.map(block => block.digest),
	};
}

describe.skipIf(!url)("postgres document provenance", () => {
	it("records creation and coalesces commits inside the fenced transaction", async () => {
		let storage = new PostgresStorage(url!);
		let lease: Awaited<ReturnType<typeof storage.leases.acquire>>;
		try {
			await storage.migrate();
			let now = new Date();
			await storage.users.put({ id: "U_provenance", login: "octocat", avatarUrl: "avatar", now });
			lease = await storage.leases.acquire(`provenance:${crypto.randomUUID()}`, "test", 60_000);
			if (!lease) throw new Error("could not acquire a test lease");
			let held = lease;
			let source = "# Plan\n\nFirst.\n";
			let channel = await storage.channels.create({
				id: crypto.randomUUID(),
				repositoryId: `R_${crypto.randomUUID()}`,
				repositoryOwner: "owner",
				repositoryName: "repository",
				title: "Provenance",
				createdBy: "U_provenance",
				now,
				initial: {
					generation: crypto.randomUUID(),
					epoch: "epoch",
					source,
					sourceHash: "sha256:unused",
					document: new Uint8Array(),
					sidecar: null,
					provenance: {
						...change("", source, 0, PLANNER),
						via: "creation",
						fromRevision: 0,
						blocks: blocks(source).map(after => ({
							kind: "added",
							fromRevision: 0,
							toRevision: 0,
							after,
						})),
					},
				},
			});
			let commit = (operationId: string, expectedRevision: number, provenance: ProvenanceChange) =>
				storage.collaboration.commit({
					channelId: channel.id,
					lease: held,
					expectedRevision,
					operationId,
					epoch: "epoch",
					sidecar: null,
					events: [],
					now: new Date(),
					provenance,
				});
			await commit("one", 0, change(source, "# Plan\n\nFirst!\n", 1, ALICE));
			await commit("two", 1, change("# Plan\n\nFirst!\n", "# Plan\n\nFirst!!\n", 2, ALICE));
			let replayed = await commit(
				"two",
				2,
				change("# Plan\n\nFirst!!\n", "# Plan\n\nX\n", 3, ALICE),
			);
			expect(replayed.repeated).toBe(true);

			let page = await storage.provenance.list(channel.id, 10);
			expect(page.entries.map(entry => [entry.authorType, entry.via])).toEqual([
				["agent", "creation"],
				["human", "browser"],
			]);
			expect(page.entries[1]).toMatchObject({ fromRevision: 0, toRevision: 2, actor: ALICE });
			expect(page.entries[1]!.blocks).toMatchObject([{
				kind: "modified",
				before: { source: "First.\n" },
				after: { source: "First!!\n" },
			}]);

			let first = await storage.provenance.list(channel.id, 1);
			expect(first.next).toBe(page.entries[0]!.id);
			let rest = await storage.provenance.list(channel.id, 1, first.next);
			expect(rest.entries.map(entry => entry.id)).toEqual([page.entries[1]!.id]);
		} finally {
			if (lease) await storage.leases.release(lease);
			await storage.close();
		}
	});
});
