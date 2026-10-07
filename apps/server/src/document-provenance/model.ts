/**
 * Who changed which top-level block of a document, kept beside the document.
 *
 * Provenance never enters the MDX: the dialect is an allowlist, and an export
 * must stay byte-identical whether or not anything was recorded.
 */

/** The distinction readers care about first: did a person or an agent write this? */
export const AUTHOR_TYPES = ["human", "agent", "system"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

/** How the change reached the document. */
export const VIAS = ["browser", "server", "mcp", "creation"] as const;
export type Via = (typeof VIAS)[number];

export type Person = { id?: string; handle: string };

/**
 * Which agent acted, when more than one of a kind can.
 *
 * Optional because today there is one Planner per deployment and a coding
 * agent is told apart by its MCP client. A second agent of the same kind must
 * set `id`, or its work is attributed to the first.
 */
export type AgentIdentity = { id?: string; name?: string };

export type Actor =
	| { type: "human"; kind: "user"; id: string; handle: string }
	| ({ type: "agent"; kind: "planner"; requestedBy?: Person; job?: string } & AgentIdentity)
	| ({
		type: "agent";
		kind: "coding-agent";
		user: Person;
		client?: { name: string; version: string };
	} & AgentIdentity)
	| { type: "system"; kind: "server" };

/** One top-level block as it stood at a revision. `source` is its canonical MDX. */
export type BlockState = { index: number; digest: string; source: string };

export const BLOCK_KINDS = ["added", "removed", "modified", "moved"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/**
 * What happened to one block between two plan revisions.
 *
 * Revisions are per block because an entry can stay open while somebody else
 * edits other blocks; replaying one block's history orders by these, not by
 * the entry that holds them.
 */
export type BlockChange = {
	kind: BlockKind;
	fromRevision: number;
	toRevision: number;
	before?: BlockState;
	after?: BlockState;
};

/** One committed document change, as the plan service hands it to storage. */
export type ProvenanceChange = {
	actor: Actor;
	via: Via;
	fromRevision: number;
	toRevision: number;
	blocks: BlockChange[];
	/** Digests of every block after the change, to keep coalesced indices current. */
	afterDigests: string[];
};

/** A stored burst of one actor's changes. */
export type ProvenanceEntry = {
	id: string;
	channelId: string;
	authorType: AuthorType;
	actorKey: string;
	actor: Actor;
	via: Via;
	fromRevision: number;
	toRevision: number;
	startedAt: Date;
	endedAt: Date;
	blocks: BlockChange[];
};

export type ProvenancePage = { entries: ProvenanceEntry[]; next?: string };

/** Read access for later consumers. Writes happen inside collaboration commits. */
export interface ProvenanceStore {
	list(channelId: string, limit: number, after?: string): Promise<ProvenancePage>;
}
