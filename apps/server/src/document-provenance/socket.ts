import * as Comments from "../comments/service";
import * as edit from "../plan/edit";
import * as room from "../plan/room";
import * as Service from "../plan/service";
import * as Questions from "../questions/service";
import { fail, reply } from "../wire";
import { attribute } from "./authorship";
import { blocks } from "./blocks";
import { enabled, person } from "./context";

import type { Provenance, Request } from "@chopin/protocol";
import type { Plan } from "../plan/service";
import type { Room } from "../rooms";
import type { Socket } from "../wire";
import type { ProvenanceEntry, ProvenanceStore } from "./model";

/** Entries read per page while assembling a document's whole history. */
const PAGE = 500;

async function history(store: ProvenanceStore, channelId: string): Promise<ProvenanceEntry[]> {
	let entries: ProvenanceEntry[] = [];
	let after: string | undefined;
	do {
		let page = await store.list(channelId, PAGE, after);
		entries.push(...page.entries);
		after = page.next;
	} while (after);
	return entries;
}

function opened(target: Room, ws: Socket, rid: string): Plan | undefined {
	if (!enabled()) {
		fail(ws, rid, "document provenance is off");
		return undefined;
	}
	if (!target.plan) fail(ws, rid, "document is not open");
	return target.plan;
}

/**
 * Who last wrote each block, anchored for this document's current epoch.
 *
 * History is read first and the document after, inside the plan queue, so
 * the blocks and their anchors describe one committed state. A commit landing
 * between the two leaves its blocks unattributed until the next read, which
 * the update that commit publishes prompts.
 */
export async function authorship(
	target: Room,
	ws: Socket,
	frame: Request<Provenance.Authorship.Ask>,
): Promise<void> {
	let plan = opened(target, ws, frame.rid);
	if (!plan) return;
	try {
		let entries = await history(plan.persistence.storage.provenance, plan.id);
		let answer = await Service.exclusive(plan, () => {
			let document = plan.document;
			let found = attribute(entries, blocks(room.project(document)));
			let wired: Provenance.Block[] = [];
			for (let block of found.blocks) {
				let anchor;
				try {
					anchor = room.anchorAt(document, block.index, block.digest);
				} catch {
					continue;
				}
				let { digest: _digest, restore: _restore, ...rest } = block;
				wired.push({ anchor, ...rest });
			}
			return Promise.resolve({
				kind: "provenance:authorship" as const,
				ts: 0,
				epoch: document.epoch,
				revision: plan.revision,
				blocks: wired,
				contributors: found.contributors,
				untracked: found.untracked,
			});
		});
		reply(ws, frame.rid, answer);
	} catch (err) {
		console.error("[provenance] could not read authorship:", err);
		fail(ws, frame.rid, "authorship is unavailable");
	}
}

/**
 * Put one block back as it was before its latest change.
 *
 * An ordinary edit by the person who asked, through the same structural edit
 * the Planner uses, so it is validated, persisted before it is published, and
 * itself recorded as that person's change. Decision projections are refused:
 * their records, not their text, are the authority.
 */
export async function restore(
	target: Room,
	ws: Socket,
	frame: Request<Provenance.Restore.Ask>,
): Promise<void> {
	let plan = opened(target, ws, frame.rid);
	if (!plan) return;
	if (!Number.isSafeInteger(frame.index) || frame.index < 0 || typeof frame.digest !== "string") {
		fail(ws, frame.rid, "invalid restore request");
		return;
	}
	try {
		let entries = await history(plan.persistence.storage.provenance, plan.id);
		let outcome = await Service.exclusive(
			plan,
			() =>
				person(ws, async (): Promise<string | number> => {
					if (Service.implementationActive(plan)) return "implementation is active";
					let current = blocks(room.project(plan.document));
					if (current[frame.index]?.digest !== frame.digest) {
						return "this block changed since you looked; try again";
					}
					let found = attribute(entries, current).blocks[frame.index];
					if (!found?.restore) return "this block has no earlier version to restore";

					let result = edit.apply(plan, plan.revision, [
						{ op: "replace", index: frame.index, source: found.restore },
					]);
					if (!result.ok) {
						return result.reason === "invalid" ? result.message : "the document changed; try again";
					}
					Questions.rebase(plan);
					Comments.rebase(plan);
					if (result.mutation) await Service.publish(plan, plan.server, plan.id, result.mutation);
					Service.anchors(plan, plan.server, plan.id);
					return plan.revision;
				}),
		);
		if (typeof outcome === "string") {
			fail(ws, frame.rid, outcome);
			return;
		}
		reply(ws, frame.rid, { kind: "provenance:restore", ts: 0, revision: outcome });
	} catch (err) {
		console.error("[provenance] could not restore a block:", err);
		fail(ws, frame.rid, "the block could not be restored");
	}
}
