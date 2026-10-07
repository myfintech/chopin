import type { Frame, Request } from "./index";
import type { Plan } from "./plan";

type KIND<K extends string> = Frame & { kind: K };

/**
 * Who last wrote each block of the document.
 *
 * Read from the provenance the server records beside the document. Nothing
 * here is part of the document itself, and nothing is offered unless the
 * deployment records provenance at all.
 */
export declare namespace Provenance {
	export type Incoming = Request<Authorship.Ask> | Request<Restore.Ask>;

	export type Outgoing = Authorship.Reply | Restore.Reply;

	/**
	 * An author, as a reader tells them apart.
	 *
	 * `key` is the identity: one person, or one agent whoever asked it. Who asked
	 * an agent travels beside it as `for`, so a person's Planner requests are not
	 * a separate author from anybody else's.
	 */
	export type Author =
		| { type: "human"; key: string; handle: string }
		| {
			type: "agent";
			key: string;
			kind: "planner" | "coding-agent";
			name: string;
			/** Handle of the person the agent acted for, when there was one. */
			for?: string;
			/** Background job kind, when the agent was not asked by anyone. */
			job?: string;
			client?: { name: string; version: string };
		}
		| { type: "system"; key: "system" };

	export type ChangeKind = "added" | "removed" | "modified" | "moved";

	/** One change in a block's history. */
	export type Contribution = {
		author: Author;
		kind: ChangeKind;
		/** ISO time the change was last extended. */
		at: string;
		fromRevision: number;
		toRevision: number;
	};

	export type Block = {
		anchor: Plan.Anchor;
		/** Position in the canonical block order when this was read. The anchor's digest is the identity. */
		index: number;
		/** Absent when nothing recorded wrote this block, such as text from before recording. */
		author?: Author;
		/** ISO time of the change that made the block what it is. */
		at?: string;
		/** Distinct authors who have changed this block. */
		contributors: number;
		/** Newest first, bounded. Moves are listed; they do not change the author. */
		history: Contribution[];
		/** Canonical MDX before and after the latest change, when short enough to compare. */
		before?: string;
		after?: string;
		/** Whether the latest change can be undone by restoring its `before`. */
		restorable: boolean;
	};

	export type Contributor = {
		author: Author;
		blocks: number;
		/** Characters of current canonical source this author last wrote. */
		characters: number;
	};

	export namespace Authorship {
		export type Ask = KIND<"provenance:authorship">;

		export type Reply = KIND<"provenance:authorship"> & {
			epoch: string;
			revision: number;
			blocks: Block[];
			/** Largest share first. */
			contributors: Contributor[];
			/** Characters of current source no recorded change accounts for. */
			untracked: number;
		};
	}

	/**
	 * Put a block back as it was before its latest change.
	 *
	 * Addressed by the block's index and its current digest, so a block that
	 * changed since the reader looked is refused rather than overwritten. The
	 * restore is an ordinary edit by the person who asked for it.
	 */
	export namespace Restore {
		export type Ask = KIND<"provenance:restore"> & { index: number; digest: string };

		export type Reply = KIND<"provenance:restore"> & { revision: number };
	}
}
