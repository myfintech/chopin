import { blocks, diff } from "./blocks";
import { current, enabled } from "./context";

import type { Socket } from "../wire";
import type { BlockState, ProvenanceChange } from "./model";

export {
	agentTools,
	browser,
	codingAgent,
	enabled,
	plannerAuthored,
	plannerTurn,
	receive,
} from "./context";
export type * from "./model";

/** Recently committed sources, so the next commit need not re-parse its "before". */
const parsed = new Map<string, BlockState[]>();
const PARSED_LIMIT = 64;

function split(source: string): BlockState[] {
	let found = parsed.get(source);
	if (found) {
		parsed.delete(source);
	} else {
		found = blocks(source);
	}
	parsed.set(source, found);
	while (parsed.size > PARSED_LIMIT) parsed.delete(parsed.keys().next().value!);
	return found;
}

/**
 * The provenance a collaboration commit should persist, as an optional field.
 *
 * Attribution is secondary to the document: a source that cannot be split is
 * logged and committed without provenance rather than failing the edit.
 */
export function commitField(
	before: string,
	{ source: after, revision }: { source: string; revision: number },
): { provenance?: ProvenanceChange } {
	if (!enabled() || before === after) return {};
	try {
		let next = split(after);
		let changes = diff(split(before), next, revision - 1, revision);
		if (changes.length === 0) return {};
		let { actor, via } = current();
		return {
			provenance: {
				actor,
				via,
				fromRevision: revision - 1,
				toRevision: revision,
				blocks: changes,
				afterDigests: next.map(block => block.digest),
			},
		};
	} catch (err) {
		console.warn("[provenance] could not attribute a document change:", err);
		return {};
	}
}

/** Revision-zero provenance for a document created with content. */
export function creationField(source: string): { provenance?: ProvenanceChange } {
	if (!enabled() || !source) return {};
	try {
		let next = blocks(source);
		if (next.length === 0) return {};
		return {
			provenance: {
				actor: current().actor,
				via: "creation",
				fromRevision: 0,
				toRevision: 0,
				blocks: next.map(after => ({ kind: "added", fromRevision: 0, toRevision: 0, after })),
				afterDigests: next.map(block => block.digest),
			},
		};
	} catch (err) {
		console.warn("[provenance] could not attribute a created document:", err);
		return {};
	}
}

/** Queued updates from a run that started before an epoch rotation were already reset. */
const queuedEpoch = new WeakMap<object, string>();

/**
 * The next batch to commit: the leading run of one author's queued updates.
 *
 * Splitting keeps arrival order, so no update is committed before one it
 * depends on. Updates left queued across a rebuild belong to a history the
 * room no longer holds; their clients were told to reopen, as a rejected
 * batch's would be, and they are dropped here.
 */
export function take<T extends { ws: Socket }>(queue: T[], epoch: string): [batch: T[], rest: T[]] {
	if (!enabled()) return [queue, []];
	let live = queue.filter(item => (queuedEpoch.get(item) ?? epoch) === epoch);
	let author = live[0]?.ws.data.principalId;
	let length = live.findIndex(item => item.ws.data.principalId !== author);
	let batch = length < 0 ? live : live.slice(0, length);
	let rest = live.slice(batch.length);
	for (let item of rest) queuedEpoch.set(item, epoch);
	return [batch, rest];
}
