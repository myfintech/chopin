/**
 * Who wrote each block, as this reader is shown it.
 *
 * The server works authorship out from recorded provenance and anchors each
 * block for the current epoch; this keeps the latest answer, refreshes it
 * after the document changes, and holds the reader's own choices: whether the
 * margin is showing, and which contributor it is focused on. None of it is
 * shared with anyone else in the room.
 */

import type { Binding } from "@lexical/yjs";
import type { LexicalEditor } from "lexical";
import type { Provenance } from "@chopin/protocol";
import type { Transport, Unsubscribe } from "../transport";

/** Quiet time after the last document change before asking again. */
const SETTLE_MS = 700;
const VISIBLE_KEY = "chopin:authorship";
/** The server's answer when this deployment records no provenance. */
const OFF = "document provenance is off";

/** Focus on one author by key, or on every agent. */
export type Focus = string | "agents";

export type AuthorshipView = {
	/** Unknown until the server has been asked once. */
	available?: boolean;
	visible: boolean;
	focus?: Focus;
	data?: Provenance.Authorship.Reply;
	/** The digest of a block being restored. */
	restoring?: string;
	error?: string;
};

function remembered(): boolean {
	try {
		return localStorage.getItem(VISIBLE_KEY) === "on";
	} catch {
		return false;
	}
}

function remember(visible: boolean): void {
	try {
		if (visible) localStorage.setItem(VISIBLE_KEY, "on");
		else localStorage.removeItem(VISIBLE_KEY);
	} catch {
		// A private window or blocked storage only costs the preference.
	}
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function matches(author: Provenance.Author | undefined, focus: Focus | undefined): boolean {
	if (focus === undefined) return true;
	if (!author) return false;
	return focus === "agents" ? author.type === "agent" : author.key === focus;
}

export class AuthorshipStore {
	#listeners = new Set<() => void>();
	#view: AuthorshipView = { visible: remembered() };

	#wire: Transport | undefined;
	#off: Unsubscribe[] = [];
	#synced = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#asking = false;
	#again = false;
	#request = 0;

	editor: LexicalEditor | undefined;
	binding: Binding | undefined;

	subscribe = (listener: () => void): () => void => {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	};

	snapshot = (): AuthorshipView => this.#view;

	#set(next: Partial<AuthorshipView>): void {
		this.#view = { ...this.#view, ...next };
		for (let listener of this.#listeners) listener();
	}

	// -- attachment ----------------------------------------------------------

	/** The editor, so an anchor can become an element; the layer re-measures when it arrives. */
	attach(editor: LexicalEditor | undefined): void {
		if (this.editor === editor) return;
		this.editor = editor;
		this.#set({});
	}

	bind(binding: Binding | undefined): void {
		if (this.binding === binding) return;
		this.binding = binding;
		this.#set({});
	}

	/**
	 * Follow one connection, and the document's sync state on it.
	 *
	 * Asked once the document is synced, because the server can only answer for
	 * a document it has open. Committed changes reach this client as an update
	 * from someone else or an acknowledgement of its own, and either is
	 * published only after the change, and its provenance, are durable.
	 */
	connect(wire: Transport | undefined, synced: boolean): void {
		if (wire !== this.#wire) {
			for (let off of this.#off) off();
			this.#off = [];
			this.#wire = wire;
			this.#request++;
			this.#set({ data: undefined, restoring: undefined, error: undefined });
			if (wire) {
				let changed = () => this.#changed();
				this.#off = [
					wire.on("plan:update", changed),
					wire.on("plan:ack", changed),
					wire.on("plan:reset", () => this.#set({ data: undefined })),
				];
			}
		}
		let opened = synced && !this.#synced;
		this.#synced = synced;
		if (opened && (this.#view.available === undefined || this.#view.visible)) void this.refresh();
	}

	dispose(): void {
		for (let off of this.#off) off();
		this.#off = [];
		this.#wire = undefined;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	// -- the reader's choices ------------------------------------------------

	toggle(visible = !this.#view.visible): void {
		remember(visible);
		this.#set({ visible, ...(visible ? {} : { focus: undefined }) });
		if (visible) void this.refresh();
	}

	focus(focus: Focus | undefined): void {
		this.#set({ focus: this.#view.focus === focus ? undefined : focus });
	}

	// -- asking the server ---------------------------------------------------

	#changed(): void {
		if (!this.#view.visible || !this.#synced) return;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.refresh();
		}, SETTLE_MS);
	}

	/** Ask for authorship now, or once more after the request already in flight. */
	async refresh(): Promise<void> {
		let wire = this.#wire;
		if (!wire || !this.#synced || this.#view.available === false) return;
		if (this.#asking) {
			this.#again = true;
			return;
		}
		this.#asking = true;
		let request = ++this.#request;
		try {
			let reply = await wire.ask<Provenance.Authorship.Reply>("provenance:authorship");
			if (request === this.#request) {
				this.#set({ available: true, data: reply, error: undefined });
			}
		} catch (err) {
			if (request === this.#request) {
				let text = message(err);
				if (text === OFF) this.#set({ available: false, visible: false, data: undefined });
				else this.#set({ error: text });
			}
		} finally {
			this.#asking = false;
			if (this.#again) {
				this.#again = false;
				void this.refresh();
			}
		}
	}

	/** Undo a block's latest change, as an edit by this reader. */
	async restore(index: number, digest: string): Promise<void> {
		let wire = this.#wire;
		if (!wire || this.#view.restoring) return;
		this.#set({ restoring: digest, error: undefined });
		try {
			await wire.ask<Provenance.Restore.Reply>("provenance:restore", { index, digest });
			this.#set({ restoring: undefined });
			void this.refresh();
		} catch (err) {
			this.#set({ restoring: undefined, error: message(err) });
		}
	}
}
