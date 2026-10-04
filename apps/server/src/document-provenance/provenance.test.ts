import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { ulid } from "@chopin/dialect";
import { tool } from "ai";
import { $getRoot, $isElementNode, $isTextNode } from "lexical";
import * as Y from "yjs";
import { z } from "zod";

import * as Room from "../plan/room";
import * as Service from "../plan/service";
import { openPlan } from "../testing/plan";
import { agentTools, codingAgent, receive } from ".";

import type { MemoryStorage } from "../storage/memory/adapter";
import type { Socket } from "../wire";

let previous: string | undefined;
let contexts: Array<Awaited<ReturnType<typeof openPlan>>> = [];

beforeAll(() => {
	previous = process.env.DOCUMENT_PROVENANCE;
	process.env.DOCUMENT_PROVENANCE = "on";
});

afterAll(() => {
	if (previous === undefined) delete process.env.DOCUMENT_PROVENANCE;
	else process.env.DOCUMENT_PROVENANCE = previous;
});

afterEach(async () => {
	for (let context of contexts.splice(0)) await Service.close(context.plan);
});

async function opened(source: string) {
	let context = await openPlan(source);
	contexts.push(context);
	return context;
}

function socket(id: string, handle: string): Socket {
	return {
		data: { room: "room", handle, client: `${handle}-tab`, canEdit: true, principalId: id },
		send() {},
		publish() {},
		close() {},
	} as unknown as Socket;
}

/** A browser peer replacing `find` with `replacement` in one paragraph. */
async function edit(plan: Service.Plan, find: string, replacement: string): Promise<Uint8Array> {
	let peer = await Room.restore(
		plan.document.epoch,
		Y.encodeStateAsUpdate(plan.document.doc),
		Service.source(plan),
		[],
	);
	try {
		let before = Y.encodeStateVector(peer.doc);
		peer.editor.update(() => {
			for (let block of $getRoot().getChildren()) {
				if (!$isElementNode(block)) continue;
				for (let leaf of block.getChildren()) {
					if (!$isTextNode(leaf) || !leaf.getTextContent().includes(find)) continue;
					leaf.setTextContent(leaf.getTextContent().replace(find, replacement));
					return;
				}
			}
			throw new Error(`no text contains ${find}`);
		}, { discrete: true });
		await Room.settle();
		return Y.encodeStateAsUpdate(peer.doc, before);
	} finally {
		peer.doc.destroy();
	}
}

function submit(plan: Service.Plan, ws: Socket, update: Uint8Array): void {
	Service.submit(plan, ws, {
		kind: "plan:update",
		ts: 0,
		rid: ulid(),
		id: ulid(),
		epoch: plan.document.epoch,
		update: Buffer.from(update).toString("base64"),
	});
}

async function settled(plan: Service.Plan): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt++) {
		await Bun.sleep(20);
		await plan.flushing;
	}
}

async function entries(storage: MemoryStorage, channelId: string) {
	return (await storage.provenance.list(channelId, 100)).entries;
}

function record(source: string, revision: number) {
	return {
		idempotencyKey: crypto.randomUUID(),
		fingerprint: "fingerprint",
		fromRevision: revision - 1,
		client: { name: "test-agent", version: "1.0.0" },
		document: { source, revision, title: "Test plan", url: "/owner/repository/test-plan" },
	};
}

const BASE =
	"# Plan\n\nThe service retries failed jobs three times.\n\nAlerts go to the on-call rotation.\n";

describe("document provenance through the plan service", () => {
	it("splits one browser batch by author and credits each person's block", async () => {
		let { plan, storage, channel } = await opened(BASE);
		let alice = socket("U_alice", "alice");
		let bob = socket("U_bob", "bob");
		let first = await edit(plan, "jobs three", "requests five");
		let second = await edit(plan, "on-call rotation", "platform team");
		submit(plan, alice, first);
		submit(plan, bob, second);
		await settled(plan);

		expect(Service.source(plan)).toContain("requests five");
		expect(Service.source(plan)).toContain("platform team");
		let found = await entries(storage, channel.id);
		expect(found.map(value => [value.authorType, value.via, value.actor])).toEqual([
			["human", "browser", { type: "human", kind: "user", id: "U_alice", handle: "alice" }],
			["human", "browser", { type: "human", kind: "user", id: "U_bob", handle: "bob" }],
		]);
		expect(found[0]!.blocks).toMatchObject([{
			kind: "modified",
			before: { source: "The service retries failed jobs three times.\n", index: 1 },
			after: { source: "The service retries failed requests five times.\n", index: 1 },
		}]);
		expect(found[1]!.blocks).toMatchObject([{
			kind: "modified",
			before: { source: "Alerts go to the on-call rotation.\n", index: 2 },
			after: { source: "Alerts go to the platform team.\n", index: 2 },
		}]);
	});

	it("coalesces a person's consecutive edits into one entry", async () => {
		let { plan, storage, channel } = await opened(BASE);
		let alice = socket("U_alice", "alice");
		submit(plan, alice, await edit(plan, "three", "five"));
		await settled(plan);
		submit(plan, alice, await edit(plan, "jobs", "requests"));
		await settled(plan);

		let found = await entries(storage, channel.id);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ fromRevision: 0, toRevision: 2 });
		expect(found[0]!.blocks).toMatchObject([{
			kind: "modified",
			fromRevision: 0,
			toRevision: 2,
			before: { source: "The service retries failed jobs three times.\n" },
			after: { source: "The service retries failed requests five times.\n" },
		}]);
	});

	it("credits an MCP rewrite to the coding agent and its GitHub user", async () => {
		let { plan, storage, channel } = await opened(BASE);
		let rewrite = codingAgent(
			{ id: "U_carol", login: "carol" },
			{ name: "test-agent", version: "1.0.0" },
			Service.rewrite,
		);
		let next = BASE.replace("Alerts go to the on-call rotation.", "Alerts page the owner.");
		let outcome = await rewrite(plan, next, record);
		expect(outcome.ok).toBe(true);

		let [found] = await entries(storage, channel.id);
		expect(found).toMatchObject({
			authorType: "agent",
			via: "mcp",
			actor: {
				type: "agent",
				kind: "coding-agent",
				user: { id: "U_carol", handle: "carol" },
				client: { name: "test-agent", version: "1.0.0" },
			},
		});
		expect(found!.blocks).toMatchObject([{
			kind: "modified",
			after: { source: "Alerts page the owner.\n" },
		}]);
	});

	it("credits a Planner tool to the agent even inside a person's socket handler", async () => {
		let { plan, storage, channel } = await opened(BASE);
		let tools = agentTools({
			edit: tool({
				inputSchema: z.object({}),
				execute: async () => {
					let next = BASE.replace("three times", "until it succeeds");
					await Service.rewrite(plan, next, record);
					return "done";
				},
			}),
		});
		let frame = JSON.stringify({ kind: "question:submit", ts: 0, rid: ulid() });
		await receive(socket("U_alice", "alice"), frame, async () => {
			await tools.edit!.execute!({}, { toolCallId: "call", messages: [] } as never);
		});

		let [found] = await entries(storage, channel.id);
		expect(found).toMatchObject({
			authorType: "agent",
			actor: { type: "agent", kind: "planner" },
		});
	});

	it("credits a person's decision frame, and nothing it leaves running, to that person", async () => {
		let { plan, storage, channel } = await opened(BASE);
		let frame = JSON.stringify({ kind: "question:submit", ts: 0, rid: ulid() });
		let lingering: Promise<void> | undefined;
		await receive(socket("U_alice", "alice"), frame, async () => {
			await Service.rewrite(plan, BASE.replace("three", "four"), record);
			lingering = Bun.sleep(5).then(async () => {
				await Service.rewrite(plan, BASE.replace("three", "six"), record);
			});
		});
		await lingering;

		let found = await entries(storage, channel.id);
		expect(found.map(value => [value.authorType, value.via])).toEqual([
			["human", "server"],
			["system", "server"],
		]);
	});

	it("records the content of a created document at revision zero", async () => {
		let { storage } = await opened("");
		let start = codingAgent({ id: "U_carol", login: "carol" }, undefined, Service.initial);
		let initial = await start("# Created\n\nFirst paragraph.\n");
		let channel = await storage.channels.create({
			id: crypto.randomUUID(),
			repositoryId: "R_test",
			repositoryOwner: "owner",
			repositoryName: "repository",
			title: "Created plan",
			createdBy: "U_test",
			now: new Date(),
			initial,
		});

		let [found] = await entries(storage, channel.id);
		expect(found).toMatchObject({
			authorType: "agent",
			via: "creation",
			fromRevision: 0,
			toRevision: 0,
		});
		expect(found!.blocks.map(block => [block.kind, block.after?.source])).toEqual([
			["added", "# Created\n"],
			["added", "First paragraph.\n"],
		]);
	});

	it("records nothing and keeps one batch when the feature is off", async () => {
		process.env.DOCUMENT_PROVENANCE = "off";
		try {
			let { plan, storage, channel } = await opened(BASE);
			submit(plan, socket("U_alice", "alice"), await edit(plan, "three", "five"));
			await settled(plan);
			expect(Service.source(plan)).toContain("five times");
			expect(await entries(storage, channel.id)).toEqual([]);
			expect((await Service.initial("# Off\n")).provenance).toBeUndefined();
		} finally {
			process.env.DOCUMENT_PROVENANCE = "on";
		}
	});
});
