/**
 * The contributor list above the document, and the header switch that shows it.
 *
 * Choosing a contributor, or every agent at once, dims everyone else's blocks
 * and offers a way to step through what they wrote.
 */

import { useState, useSyncExternalStore } from "react";
import { ChevronIcon, CloseIcon } from "@chopin/icons";

import { AuthorFace } from "./faces";
import { elementsFor, scrollerOf } from "./layer";
import { agentShare, authorName, shares } from "./model";
import { matches } from "./store";

import type { AuthorshipStore, Focus } from "./store";

import "./authorship.css";

export function AuthorshipToggle({ store }: { store: AuthorshipStore }) {
	let view = useSyncExternalStore(store.subscribe, store.snapshot);
	if (view.available !== true) return null;
	// The header grows every button to a 44px touch target on a coarse pointer, so
	// the visible pill is drawn inside the button rather than on it.
	return (
		<button
			aria-pressed={view.visible}
			className="btn btn-sm mr-2 shrink-0 bg-transparent p-0"
			onClick={() => store.toggle()}
			type="button"
		>
			<span className="authorship-toggle-pill">Authorship</span>
		</button>
	);
}

const REACHED = "data-authorship-reached";
const REACHED_MS = 1200;
let reached: HTMLElement | undefined;
let reachedTimer: ReturnType<typeof setTimeout> | undefined;

/** The focused contributor's blocks in document order, with their elements. */
function targets(store: AuthorshipStore): Array<{ digest: string; element: HTMLElement }> {
	let view = store.snapshot();
	if (!view.data) return [];
	let blocks = view.data.blocks
		.filter(block => matches(block.author, view.focus))
		.sort((a, b) => a.index - b.index);
	return [...elementsFor(store, blocks)].map(([block, element]) => ({
		digest: block.anchor.digest,
		element,
	}));
}

/** The first focused block not yet scrolled past, where stepping starts. */
function visibleStart(store: AuthorshipStore, list: Array<{ element: HTMLElement }>): number {
	let top = scrollerOf(store)?.getBoundingClientRect().top ?? 0;
	let found = list.findIndex(item => item.element.getBoundingClientRect().bottom > top + 4);
	return found < 0 ? list.length - 1 : found;
}

/**
 * Show one block and mark it for a moment.
 *
 * Instant rather than smooth: the editor writes its remembered scroll position
 * back on every scroll event, and that write cancels a smooth scroll after its
 * first frame. Blocks near the top or bottom cannot be centred at all, which
 * is why stepping follows a position in the list rather than the viewport.
 */
function reach(element: HTMLElement): void {
	element.scrollIntoView({ block: "center", behavior: "auto" });
	clearTimeout(reachedTimer);
	reached?.removeAttribute(REACHED);
	reached = element;
	element.setAttribute(REACHED, "");
	reachedTimer = setTimeout(() => element.removeAttribute(REACHED), REACHED_MS);
}

export function AuthorshipStrip({ store }: { store: AuthorshipStore }) {
	let view = useSyncExternalStore(store.subscribe, store.snapshot);
	// The block last stepped to, by digest; a new focus starts over.
	let [cursor, setCursor] = useState<{ focus: Focus | undefined; digest: string }>();
	if (!view.visible || view.available !== true) return null;
	let data = view.data;
	let people = data ? shares(data) : [];
	// Always present once any agent has written here, so the reader can rely on
	// finding it, even when a single agent's chip says the same thing.
	let agents = data ? agentShare(data) : undefined;
	let focused = data?.blocks.filter(block => matches(block.author, view.focus)).length ?? 0;
	let current = cursor?.focus === view.focus ? cursor?.digest : undefined;
	let position = current === undefined
		? undefined
		: data?.blocks
			.filter(block => matches(block.author, view.focus))
			.sort((a, b) => a.index - b.index)
			.findIndex(block => block.anchor.digest === current);
	if (position === -1) position = undefined;
	let step = (direction: -1 | 1) => {
		let list = targets(store);
		if (list.length === 0) return;
		let at = list.findIndex(item => item.digest === current);
		let next = at < 0
			? visibleStart(store, list)
			: Math.max(0, Math.min(list.length - 1, at + direction));
		let target = list[next]!;
		setCursor({ focus: view.focus, digest: target.digest });
		reach(target.element);
	};
	let system = people.filter(item => item.author.type === "system");
	let named = people.filter(item => item.author.type !== "system");

	return (
		<div aria-label="Contributors" className="authorship-strip" role="toolbar">
			<span className="authorship-strip-label">Contributors</span>
			{!data && <span className="authorship-strip-note">Loading…</span>}
			{named.map(item => (
				<button
					aria-pressed={view.focus === item.author.key}
					className="authorship-chip"
					data-dimmed={view.focus !== undefined && view.focus !== item.author.key ? "" : undefined}
					key={item.author.key}
					onClick={() => store.focus(item.author.key)}
					type="button"
				>
					<AuthorFace author={item.author} badge={false} size={18} />
					<span>{authorName(item.author)}</span>
					<span className="authorship-share">{item.percent}%</span>
				</button>
			))}
			{system.map(item => (
				<span className="authorship-chip authorship-chip-static" key={item.author.key}>
					<span>System</span>
					<span className="authorship-share">{item.percent}%</span>
				</span>
			))}
			{agents && (
				<>
					<span aria-hidden="true" className="authorship-strip-rule" />
					<button
						aria-pressed={view.focus === "agents"}
						className="authorship-chip"
						data-dimmed={view.focus !== undefined && view.focus !== "agents" ? "" : undefined}
						onClick={() => store.focus("agents")}
						type="button"
					>
						<span aria-hidden="true" className="authorship-agents-mark" />
						<span>Agents</span>
						<span className="authorship-share">{agents.percent}%</span>
					</button>
				</>
			)}
			{view.focus !== undefined && (
				<span className="authorship-focus">
					<span aria-live="polite">
						{position === undefined
							? `${focused} ${focused === 1 ? "block" : "blocks"}`
							: `${position + 1} of ${focused}`}
					</span>
					<button
						aria-label="Previous block"
						className="btn btn-icon btn-ghost"
						disabled={position === 0}
						onClick={() => step(-1)}
						type="button"
					>
						<ChevronIcon aria-hidden="true" className="-rotate-90" />
					</button>
					<button
						aria-label="Next block"
						className="btn btn-icon btn-ghost"
						disabled={position !== undefined && position >= focused - 1}
						onClick={() => step(1)}
						type="button"
					>
						<ChevronIcon aria-hidden="true" className="rotate-90" />
					</button>
					<button
						aria-label="Clear focus"
						className="btn btn-icon btn-ghost"
						onClick={() => store.focus(undefined)}
						type="button"
					>
						<CloseIcon aria-hidden="true" />
					</button>
				</span>
			)}
			{view.error && (
				<span className="authorship-strip-note" role="status">
					{view.error}
				</span>
			)}
		</div>
	);
}
