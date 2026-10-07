import { corrupt } from "../storage/errors";
import { actorKey, entry, extend } from "./merge";
import { AUTHOR_TYPES, VIAS } from "./model";

import type { SQL, TransactionSQL } from "bun";
import type {
	Actor,
	AuthorType,
	BlockChange,
	ProvenanceChange,
	ProvenanceEntry,
	ProvenancePage,
	ProvenanceStore,
	Via,
} from "./model";

type Run = <T>(action: string, execute: () => Promise<T>) => Promise<T>;
type Integer = bigint | number | string;

type EntryRow = {
	channelId: string;
	id: string;
	authorType: string;
	actorKey: string;
	actor: unknown;
	via: string;
	fromRevision: Integer;
	toRevision: Integer;
	startedAt: Date;
	endedAt: Date;
	blocks: unknown;
};

const COLUMNS = `
	channel_id AS "channelId", id, author_type AS "authorType", actor_key AS "actorKey", actor,
	via, from_revision AS "fromRevision", to_revision AS "toRevision",
	started_at AS "startedAt", ended_at AS "endedAt", blocks
`;

function integer(value: Integer, field: string): number {
	let parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw corrupt(`storage returned an invalid ${field}`);
	}
	return parsed;
}

function json(value: unknown, field: string): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch (err) {
		throw corrupt(`storage returned invalid JSON for ${field}`, err);
	}
}

function stored(row: EntryRow): ProvenanceEntry {
	let actor = json(row.actor, "provenance actor");
	let blocks = json(row.blocks, "provenance blocks");
	if (!AUTHOR_TYPES.includes(row.authorType as AuthorType)) {
		throw corrupt("storage returned an invalid provenance author type");
	}
	if (!VIAS.includes(row.via as Via)) throw corrupt("storage returned an invalid provenance via");
	if (!actor || typeof actor !== "object" || (actor as Actor).type !== row.authorType) {
		throw corrupt("storage returned an invalid provenance actor");
	}
	if (!Array.isArray(blocks)) throw corrupt("storage returned invalid provenance blocks");
	return {
		id: row.id,
		channelId: row.channelId,
		authorType: row.authorType as AuthorType,
		actorKey: row.actorKey,
		actor: actor as Actor,
		via: row.via as Via,
		fromRevision: integer(row.fromRevision, "provenance revision"),
		toRevision: integer(row.toRevision, "provenance revision"),
		startedAt: new Date(row.startedAt),
		endedAt: new Date(row.endedAt),
		blocks: blocks as BlockChange[],
	};
}

export class PostgresProvenanceStore implements ProvenanceStore {
	readonly #sql: SQL;
	readonly #run: Run;

	constructor(sql: SQL, run: Run) {
		this.#sql = sql;
		this.#run = run;
	}

	/**
	 * Fold a change into its actor's open entry, inside the caller's commit.
	 *
	 * The channel row is already locked by the commit, so two changes to one
	 * channel cannot race for the same open entry.
	 */
	async record(
		transaction: TransactionSQL,
		channelId: string,
		change: ProvenanceChange,
		now: Date,
	): Promise<void> {
		let [found] = await transaction<EntryRow[]>`
			SELECT ${transaction.unsafe(COLUMNS)}
			FROM document_changes
			WHERE channel_id = ${channelId} AND actor_key = ${actorKey(change.actor)}
				AND via = ${change.via}
			ORDER BY ended_at DESC, id DESC
			LIMIT 1
		`;
		let merged = found ? extend(stored(found), change, now) : undefined;
		if (merged) {
			await transaction`
				UPDATE document_changes
				SET to_revision = ${merged.toRevision}, ended_at = ${merged.endedAt},
					blocks = ${JSON.stringify(merged.blocks)}::text::jsonb
				WHERE channel_id = ${channelId} AND id = ${merged.id}
			`;
			return;
		}
		let created = entry(channelId, change, now);
		await transaction`
			INSERT INTO document_changes (
				channel_id, id, author_type, actor_key, actor, via, from_revision, to_revision,
				started_at, ended_at, blocks
			) VALUES (
				${channelId}, ${created.id}, ${created.authorType}, ${created.actorKey},
				${JSON.stringify(created.actor)}::text::jsonb, ${created.via}, ${created.fromRevision},
				${created.toRevision}, ${created.startedAt}, ${created.endedAt},
				${JSON.stringify(created.blocks)}::text::jsonb
			)
		`;
	}

	list(channelId: string, limit: number, after?: string): Promise<ProvenancePage> {
		let count = Math.min(500, Math.max(1, limit));
		return this.#run("list document provenance", async () => {
			let sql = this.#sql;
			let rows: EntryRow[] = after
				? await sql`
					SELECT ${sql.unsafe(COLUMNS)}
					FROM document_changes
					WHERE channel_id = ${channelId} AND (started_at, id) > (
						SELECT started_at, id FROM document_changes
						WHERE channel_id = ${channelId} AND id = ${after}
					)
					ORDER BY started_at, id
					LIMIT ${count + 1}
				`
				: await sql`
					SELECT ${sql.unsafe(COLUMNS)}
					FROM document_changes
					WHERE channel_id = ${channelId}
					ORDER BY started_at, id
					LIMIT ${count + 1}
				`;
			let entries = rows.slice(0, count).map(stored);
			let next = rows.length > count ? entries.at(-1)?.id : undefined;
			return { entries, ...(next ? { next } : {}) };
		});
	}
}
