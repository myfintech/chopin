import { actorKey, entry, extend } from "./merge";

import type { ProvenanceChange, ProvenanceEntry, ProvenancePage, ProvenanceStore } from "./model";

export class MemoryProvenanceStore implements ProvenanceStore {
	#entries = new Map<string, ProvenanceEntry[]>();

	/** Called synchronously inside the memory adapter's commit or creation. */
	record(channelId: string, recorded: ProvenanceChange, now: Date): void {
		let change = structuredClone(recorded);
		let entries = this.#entries.get(channelId) ?? [];
		let key = actorKey(change.actor);
		let open = entries.findLast(value => value.actorKey === key && value.via === change.via);
		let merged = open ? extend(open, change, now) : undefined;
		if (open && merged) entries[entries.indexOf(open)] = merged;
		else entries.push(entry(channelId, change, now));
		this.#entries.set(channelId, entries);
	}

	forget(channelId: string): void {
		this.#entries.delete(channelId);
	}

	list(channelId: string, limit: number, after?: string): Promise<ProvenancePage> {
		let count = Math.min(500, Math.max(1, limit));
		let entries = [...(this.#entries.get(channelId) ?? [])].sort((a, b) =>
			a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id)
		);
		let start = after ? entries.findIndex(value => value.id === after) + 1 : 0;
		let page = entries.slice(start, start + count);
		let next = start + count < entries.length ? page.at(-1)?.id : undefined;
		return Promise.resolve({
			entries: structuredClone(page),
			...(next ? { next } : {}),
		});
	}
}
