import type { Provenance } from "@chopin/protocol";
import type { Actor, BlockChange, BlockState, ProvenanceEntry } from "./model";

/** History items sent per block. The chain itself is followed further. */
const HISTORY = 8;
/** Longest chain followed back from one block, so a cycle of identical digests cannot spin. */
const CHAIN = 64;
/** Sources longer than this are not sent for comparison. */
const COMPARE = 2000;

type Item = { entry: ProvenanceEntry; change: BlockChange; order: number };

export type Attributed = {
	index: number;
	digest: string;
	author?: Provenance.Author;
	at?: string;
	contributors: number;
	history: Provenance.Contribution[];
	before?: string;
	after?: string;
	restorable: boolean;
	/** The source a restore writes, kept server-side whatever its length. */
	restore?: string;
};

export type Authorship = {
	blocks: Attributed[];
	contributors: Provenance.Contributor[];
	untracked: number;
};

/** The reader's view of an actor: an agent is one author whoever asked it. */
export function author(actor: Actor): Provenance.Author {
	switch (actor.kind) {
		case "user":
			return { type: "human", key: `human:${actor.id}`, handle: actor.handle };
		case "planner":
			return {
				type: "agent",
				key: `agent:planner${actor.id ? `:${actor.id}` : ""}`,
				kind: "planner",
				name: actor.name ?? "Planner",
				...(actor.requestedBy ? { for: actor.requestedBy.handle } : {}),
				...(actor.job ? { job: actor.job } : {}),
			};
		case "coding-agent":
			return {
				type: "agent",
				key: `agent:coding-agent:${actor.id ?? actor.client?.name ?? "unknown"}`,
				kind: "coding-agent",
				name: actor.name ?? actor.client?.name ?? "Coding agent",
				for: actor.user.handle,
				...(actor.client ? { client: actor.client } : {}),
			};
		case "server":
			return { type: "system", key: "system" };
	}
}

/** A dialect component, such as a decision card, rather than prose. Restoring one would bypass its record. */
function component(source: string): boolean {
	return source.trimStart().startsWith("<");
}

/**
 * Who last wrote each current block, followed back through recorded changes.
 *
 * A block is found by the change whose `after` matches its digest, preferring
 * the newest and then the nearest position. Its history continues through the
 * change whose `after` matches that change's `before`, no later than where it
 * began. A move continues the chain without changing who wrote the words.
 */
export function attribute(entries: ProvenanceEntry[], current: BlockState[]): Authorship {
	let produced = new Map<string, Item[]>();
	let order = 0;
	for (let entry of entries) {
		for (let change of entry.blocks) {
			order++;
			if (!change.after) continue;
			let list = produced.get(change.after.digest) ?? [];
			list.push({ entry, change, order });
			produced.set(change.after.digest, list);
		}
	}

	let producer = (state: BlockState, before: number | undefined, seen: Set<Item>) => {
		let best: Item | undefined;
		for (let item of produced.get(state.digest) ?? []) {
			if (seen.has(item)) continue;
			if (before !== undefined && item.change.toRevision > before) continue;
			if (!best) {
				best = item;
				continue;
			}
			let revision = item.change.toRevision - best.change.toRevision;
			let distance = Math.abs(item.change.after!.index - state.index)
				- Math.abs(best.change.after!.index - state.index);
			if (
				revision > 0
				|| (revision === 0 && (distance < 0 || (distance === 0 && item.order > best.order)))
			) {
				best = item;
			}
		}
		return best;
	};

	let shares = new Map<string, Provenance.Contributor>();
	let untracked = 0;
	let blocks = current.map((state): Attributed => {
		let chain: Item[] = [];
		let seen = new Set<Item>();
		let item = producer(state, undefined, seen);
		while (item && chain.length < CHAIN) {
			chain.push(item);
			seen.add(item);
			let { before, fromRevision } = item.change;
			item = before ? producer(before, fromRevision, seen) : undefined;
		}

		let written = chain.filter(link => link.change.kind !== "moved");
		let latest = written[0];
		let contributors = new Set(written.map(link => author(link.entry.actor).key)).size;
		let history = chain.slice(0, HISTORY).map(link => ({
			author: author(link.entry.actor),
			kind: link.change.kind,
			at: link.entry.endedAt.toISOString(),
			fromRevision: link.change.fromRevision,
			toRevision: link.change.toRevision,
		}));
		if (!latest) {
			untracked += state.source.length;
			return { index: state.index, digest: state.digest, contributors, history, restorable: false };
		}

		let by = author(latest.entry.actor);
		let share = shares.get(by.key) ?? { author: by, blocks: 0, characters: 0 };
		share.blocks++;
		share.characters += state.source.length;
		shares.set(by.key, share);

		let before = latest.change.before?.source;
		let after = latest.change.after?.source;
		let restorable = latest.change.kind === "modified" && before !== undefined
			&& !component(before) && !component(state.source);
		return {
			index: state.index,
			digest: state.digest,
			author: by,
			at: latest.entry.endedAt.toISOString(),
			contributors,
			history,
			...(before !== undefined && before.length <= COMPARE && after !== undefined
					&& after.length <= COMPARE
				? { before, after }
				: {}),
			restorable,
			...(restorable ? { restore: before } : {}),
		};
	});

	return {
		blocks,
		contributors: [...shares.values()].sort((a, b) => b.characters - a.characters),
		untracked,
	};
}
