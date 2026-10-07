import type { Actor, BlockChange, BlockState, ProvenanceChange, ProvenanceEntry } from "./model";

/** An actor's burst ends after this long without a change. */
export const IDLE_MS = 30_000;
/** A burst never spans longer than this, so one entry cannot grow without bound. */
export const SPAN_MS = 10 * 60_000;
export const MAX_BLOCKS = 200;
export const MAX_BYTES = 256 * 1024;

/** Coalescing identity: the same actor through the same route. */
export function actorKey(actor: Actor): string {
	switch (actor.kind) {
		case "user":
			return `human:${actor.id}`;
		case "planner":
			return `agent:planner:${actor.requestedBy?.id ?? actor.requestedBy?.handle ?? ""}:${
				actor.job ?? ""
			}${actor.id ? `:${actor.id}` : ""}`;
		case "coding-agent":
			return `agent:coding-agent:${actor.user.id ?? actor.user.handle}:${actor.client?.name ?? ""}${
				actor.id ? `:${actor.id}` : ""
			}`;
		case "server":
			return "system";
	}
}

export function entry(
	channelId: string,
	change: ProvenanceChange,
	now: Date,
	id: string = crypto.randomUUID(),
): ProvenanceEntry {
	return {
		id,
		channelId,
		authorType: change.actor.type,
		actorKey: actorKey(change.actor),
		actor: change.actor,
		via: change.via,
		fromRevision: change.fromRevision,
		toRevision: change.toRevision,
		startedAt: now,
		endedAt: now,
		blocks: change.blocks,
	};
}

function settled(block: BlockChange): BlockChange | undefined {
	let { before, after } = block;
	if (!before && !after) return undefined;
	if (!before) return { ...block, kind: "added" };
	if (!after) return { ...block, kind: "removed" };
	if (before.digest !== after.digest) return { ...block, kind: "modified" };
	return before.index === after.index ? undefined : { ...block, kind: "moved" };
}

/** The block in `blocks` currently showing `state`, preferring the same position. */
function holding(blocks: BlockChange[], state: BlockState): number {
	let found = -1;
	for (let [index, block] of blocks.entries()) {
		if (block.after?.digest !== state.digest) continue;
		if (block.after.index === state.index) return index;
		if (found < 0) found = index;
	}
	return found;
}

function nearest(digests: string[], digest: string, hint: number): number | undefined {
	let best: number | undefined;
	for (let [index, value] of digests.entries()) {
		if (value !== digest) continue;
		if (best === undefined || Math.abs(index - hint) < Math.abs(best - hint)) best = index;
	}
	return best;
}

/**
 * Fold a change into the actor's open entry, or say a new entry must start.
 *
 * A block keeps its first `before` and takes the latest `after`. When someone
 * else edited a block in between, its current text no longer matches what the
 * entry last saw, so the edit is appended as a separate block change with its
 * own revisions rather than merged across the other author's work.
 */
export function extend(
	open: ProvenanceEntry,
	change: ProvenanceChange,
	now: Date,
): ProvenanceEntry | undefined {
	if (open.actorKey !== actorKey(change.actor) || open.via !== change.via) return undefined;
	let elapsed = now.getTime() - open.endedAt.getTime();
	if (elapsed < 0 || elapsed > IDLE_MS) return undefined;
	if (now.getTime() - open.startedAt.getTime() > SPAN_MS) return undefined;

	let blocks = open.blocks.map(block => ({ ...block }));
	for (let incoming of change.blocks) {
		let index = incoming.before ? holding(blocks, incoming.before) : -1;
		if (index < 0) {
			blocks.push({ ...incoming });
			continue;
		}
		let merged = settled({
			...blocks[index]!,
			after: incoming.after,
			toRevision: incoming.toRevision,
		});
		if (merged) blocks[index] = merged;
		else blocks.splice(index, 1);
	}

	let result = blocks.flatMap(block => {
		if (!block.after) return [block];
		let index = nearest(change.afterDigests, block.after.digest, block.after.index);
		if (index === undefined || index === block.after.index) return [block];
		let moved = settled({ ...block, after: { ...block.after, index } });
		return moved ? [moved] : [];
	});
	if (result.length > MAX_BLOCKS) return undefined;
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_BYTES) return undefined;
	return {
		...open,
		toRevision: Math.max(open.toRevision, change.toRevision),
		endedAt: now,
		blocks: result,
	};
}
