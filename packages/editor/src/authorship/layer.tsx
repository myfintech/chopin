/**
 * The authorship margin: a face where each author's run starts, a bar beside
 * every block, and a card with the block's latest change and history.
 *
 * Reader-local chrome laid over the document, like comment and decision
 * markers. Nothing is written into the document: a mark that took space would
 * shift the line somebody else is typing in, and one in the shared document
 * would be sent to everyone. The only thing touched on a block is a dimming
 * attribute while the reader focuses on one contributor, re-applied on every
 * pass because Lexical rebuilds a block's element when the block changes.
 */

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import * as Y from "yjs";

import { blockElement } from "../scroll";
import { AuthorFace } from "./faces";
import { ago, authorName, contribution, marks, onBehalf, when } from "./model";
import { words } from "./words";

import type { Provenance } from "@chopin/protocol";
import type { Mark } from "./model";
import type { AuthorshipStore, AuthorshipView } from "./store";

import "./authorship.css";

/** Distances left of the prose, in pixels: the lane clears the decision marker's. */
const FACE = 60;
const BAR = 34;
const LANE = 64;
const LANE_WIDTH = 36;
const CARD_WIDTH = 400;
const CARD_GAP = 10;
const HOVER_MS = 120;
const DIMMED = "data-authorship-dimmed";
const ACTIVE = "data-authorship-active";

type Placed = { mark: Mark; top: number; height: number; element: HTMLElement };
type Frame = {
	/** Left and right edges of the prose column, relative to the scroller. */
	prose: number;
	proseEnd: number;
	width: number;
	height: number;
	top: number;
	placed: Placed[];
};

const EMPTY: Frame = { prose: 0, proseEnd: 0, width: 0, height: 0, top: 0, placed: [] };

function useView(store: AuthorshipStore): AuthorshipView {
	return useSyncExternalStore(store.subscribe, store.snapshot);
}

/** The scrolling element the document is laid out in, which is what the margin follows. */
export function scrollerOf(store: AuthorshipStore): HTMLElement | undefined {
	return store.editor?.getRootElement()?.closest<HTMLElement>("[data-plan-scroll]") ?? undefined;
}

/** Decoded relative positions, by their base64, so a pass does not decode every anchor again. */
const decoded = new Map<string, Y.RelativePosition>();
const DECODED_LIMIT = 2000;

function relative(position: string): Y.RelativePosition {
	let found = decoded.get(position);
	if (found) return found;
	let binary = atob(position);
	let bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	found = Y.decodeRelativePosition(bytes);
	if (decoded.size >= DECODED_LIMIT) decoded.clear();
	decoded.set(position, found);
	return found;
}

/**
 * Elements for blocks, skipping any this editor cannot place.
 *
 * Resolves the way `resolve` in anchors does, but through one reverse map of
 * the binding per pass: that helper scans every collaborative node for each
 * anchor, and the margin resolves every block on every editor update.
 */
export function elementsFor(
	store: AuthorshipStore,
	blocks: Provenance.Block[],
): Map<Provenance.Block, HTMLElement> {
	let out = new Map<Provenance.Block, HTMLElement>();
	let { editor, binding } = store;
	if (!editor || !binding) return out;
	let keys = new Map<unknown, string>();
	for (let [key, collab] of binding.collabNodeMap) keys.set(collab.getSharedType(), key);
	for (let block of blocks) {
		if (block.anchor.orphaned) continue;
		let key: string | undefined;
		try {
			let absolute = Y.createAbsolutePositionFromRelativePosition(
				relative(block.anchor.position),
				binding.doc,
				false,
			);
			key = absolute ? keys.get(absolute.type) : undefined;
		} catch {
			// A position from a history this document no longer holds; the next read replaces it.
		}
		let element = key ? blockElement(editor, key) : undefined;
		if (element) out.set(block, element);
	}
	return out;
}

export function AuthorshipLayer({ store, canEdit }: { store: AuthorshipStore; canEdit: boolean }) {
	let view = useView(store);
	let showing = view.visible && view.available === true && !!view.data;
	let [frame, setFrame] = useState<Frame>(EMPTY);
	let painted = useRef(new Set<HTMLElement>());
	let pending = useRef(0);
	let drawn = useMemo(
		() => (showing && view.data ? marks(view.data.blocks, view.focus) : []),
		[showing, view.data, view.focus],
	);

	let measure = useCallback(() => {
		let scroller = scrollerOf(store);
		let root = store.editor?.getRootElement();
		let next = new Set<HTMLElement>();
		if (!scroller || !root || drawn.length === 0) {
			for (let element of painted.current) element.removeAttribute(DIMMED);
			painted.current = next;
			setFrame(EMPTY);
			return;
		}
		let bounds = scroller.getBoundingClientRect();
		let rootBounds = root.getBoundingClientRect();
		let padding = getComputedStyle(root);
		let prose = rootBounds.left - bounds.left + Number.parseFloat(padding.paddingLeft);
		let proseEnd = rootBounds.right - bounds.left - Number.parseFloat(padding.paddingRight);
		let elements = elementsFor(store, drawn.map(mark => mark.block));
		let placed: Placed[] = [];
		for (let mark of drawn) {
			let element = elements.get(mark.block);
			if (!element) continue;
			let rect = element.getBoundingClientRect();
			if (rect.height === 0) continue;
			placed.push({ mark, element, top: rect.top - bounds.top, height: rect.height });
			if (mark.dimmed) {
				element.setAttribute(DIMMED, "");
				next.add(element);
			}
		}
		for (let element of painted.current) if (!next.has(element)) element.removeAttribute(DIMMED);
		painted.current = next;
		setFrame({
			prose,
			proseEnd,
			width: scroller.clientWidth,
			height: scroller.clientHeight,
			top: scroller.offsetTop,
			placed,
		});
	}, [drawn, store]);

	let schedule = useCallback(() => {
		if (pending.current) return;
		pending.current = requestAnimationFrame(() => {
			pending.current = 0;
			measure();
		});
	}, [measure]);

	useLayoutEffect(() => {
		measure();
	}, [measure]);

	useEffect(() => {
		let editor = store.editor;
		let scroller = scrollerOf(store);
		let document = scroller?.parentElement;
		if (!editor || !scroller) return;
		if (showing) document?.setAttribute("data-authorship", "");
		let off = editor.registerUpdateListener(schedule);
		scroller.addEventListener("scroll", schedule, { passive: true });
		let observer = new ResizeObserver(schedule);
		observer.observe(scroller);
		let root = editor.getRootElement();
		if (root) observer.observe(root);
		return () => {
			off();
			scroller.removeEventListener("scroll", schedule);
			observer.disconnect();
			document?.removeAttribute("data-authorship");
		};
	}, [schedule, showing, store, view.data]);

	useEffect(() => () => {
		if (pending.current) cancelAnimationFrame(pending.current);
		for (let element of painted.current) element.removeAttribute(DIMMED);
		painted.current.clear();
	}, []);

	let [open, setOpen] = useState<{ digest: string; pinned: boolean }>();
	let hover = useRef<ReturnType<typeof setTimeout>>(undefined);
	let card = useRef<HTMLDivElement>(null);
	let [cardHeight, setCardHeight] = useState(0);
	useLayoutEffect(() => {
		let element = card.current;
		if (!element) return;
		let observer = new ResizeObserver(() => setCardHeight(element.offsetHeight));
		observer.observe(element);
		return () => observer.disconnect();
	}, [open?.digest]);
	let show = (digest: string, pinned = false) => {
		clearTimeout(hover.current);
		setOpen(current => (current?.pinned && !pinned ? current : { digest, pinned }));
	};
	let hide = () => {
		clearTimeout(hover.current);
		hover.current = setTimeout(
			() => setOpen(current => (current?.pinned ? current : undefined)),
			HOVER_MS,
		);
	};

	useEffect(() => {
		if (!open?.pinned) return;
		let away = (event: PointerEvent) => {
			let target = event.target as Element | null;
			if (card.current?.contains(target) || target?.closest("[data-authorship-lane]")) return;
			setOpen(undefined);
		};
		let escape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(undefined);
		};
		document.addEventListener("pointerdown", away);
		document.addEventListener("keydown", escape);
		return () => {
			document.removeEventListener("pointerdown", away);
			document.removeEventListener("keydown", escape);
		};
	}, [open?.pinned]);

	// The block a card is open for is tinted in the prose, so the card reads as about it.
	let activeElement = open
		? frame.placed.find(item => item.mark.block.anchor.digest === open.digest)?.element
		: undefined;
	useEffect(() => {
		if (!activeElement) return;
		activeElement.setAttribute(ACTIVE, "");
		return () => activeElement.removeAttribute(ACTIVE);
	}, [activeElement]);

	if (!showing || frame.placed.length === 0) return null;

	let visible = frame.placed.filter(item =>
		item.top + item.height > -40 && item.top < frame.height + 40
	);
	let active = open
		? frame.placed.find(item => item.mark.block.anchor.digest === open.digest)
		: undefined;

	return (
		<div
			className="authorship-layer"
			style={{ top: frame.top, height: frame.height }}
		>
			{visible.map(({ mark, top, height }) => {
				let { block } = mark;
				let digest = block.anchor.digest;
				let expanded = open?.digest === digest;
				let label = `${authorName(block.author)}${
					onBehalf(block.author) ? `, ${onBehalf(block.author)}` : ""
				}${block.at ? `, ${ago(block.at)}` : ""}. Show authorship`;
				return (
					<div key={`${digest}:${block.index}`} data-dimmed={mark.dimmed ? "" : undefined}>
						<span
							aria-hidden="true"
							className="authorship-bar"
							data-texture={mark.texture}
							style={{
								left: frame.prose - BAR,
								top: top + 3,
								height: Math.max(6, height - 6),
								color: mark.color,
							}}
						/>
						{mark.multi && (
							<span
								aria-hidden="true"
								className="authorship-multi"
								style={{ left: frame.prose - BAR - 10, top: top + 9 }}
							/>
						)}
						{mark.face && (
							<span
								aria-hidden="true"
								className="authorship-face"
								style={{
									left: frame.prose - FACE,
									top: top + Math.max(0, Math.min(height, 26) / 2 - 10),
								}}
							>
								<AuthorFace author={block.author} />
							</span>
						)}
						<button
							aria-expanded={expanded}
							aria-label={label}
							className="authorship-lane"
							data-authorship-lane=""
							onBlur={hide}
							onClick={() => show(digest, !(expanded && open?.pinned))}
							onFocus={() => show(digest)}
							onPointerEnter={() => {
								clearTimeout(hover.current);
								hover.current = setTimeout(() => show(digest), HOVER_MS);
							}}
							onPointerLeave={hide}
							style={{ left: Math.max(0, frame.prose - LANE), top, height, width: LANE_WIDTH }}
							type="button"
						/>
					</div>
				);
			})}
			{active && (
				<AuthorshipCard
					block={active.mark.block}
					canEdit={canEdit}
					cardRef={card}
					onPointerEnter={() => clearTimeout(hover.current)}
					onPointerLeave={hide}
					restoring={view.restoring === active.mark.block.anchor.digest}
					store={store}
					place={cardPlace(frame, active, cardHeight)}
				/>
			)}
		</div>
	);
}

/**
 * Below the block it describes, aligned to the prose's right edge, so the block
 * stays readable beside its card. Above when the view ends first, and clamped
 * when neither side has room.
 */
function cardPlace(
	frame: Frame,
	active: Placed,
	height: number,
): { left: number; top: number; width: number } {
	let width = Math.min(CARD_WIDTH, frame.width - 16);
	let left = Math.max(8, Math.min(frame.proseEnd, frame.width - 8) - width);
	let below = active.top + active.height + CARD_GAP;
	let above = active.top - CARD_GAP - height;
	let top = below + height <= frame.height - 8 || above < 8 ? below : above;
	return { left, top: Math.max(8, Math.min(top, frame.height - height - 8)), width };
}

function AuthorshipCard(
	{ block, canEdit, cardRef, onPointerEnter, onPointerLeave, place, restoring, store }: {
		block: Provenance.Block;
		canEdit: boolean;
		cardRef: React.RefObject<HTMLDivElement | null>;
		onPointerEnter: () => void;
		onPointerLeave: () => void;
		restoring: boolean;
		store: AuthorshipStore;
		place: { left: number; top: number; width: number };
	},
) {
	let { author } = block;
	let latest = block.history.find(item => item.kind !== "moved");
	let previous = block.history.find(item => item !== latest && item.kind !== "moved");
	let changed = block.before !== undefined && block.after !== undefined
		? words(block.before, block.after)
		: undefined;
	let detail = author?.type === "agent"
		? author.kind === "coding-agent"
			? (
				<>
					Through MCP{author.client ? ` (version ${author.client.version})` : ""}
					{author.for && (
						<>
							, for <strong>@{author.for}</strong>
						</>
					)}
				</>
			)
			: author.for
			? (
				<>
					Asked by <strong>@{author.for}</strong>
				</>
			)
			: author.job
			? <>Background work: {author.job.replaceAll("-", " ")}</>
			: undefined
		: undefined;
	return (
		<div
			aria-label="Block authorship"
			className="authorship-card"
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			ref={cardRef}
			role="dialog"
			style={{ left: place.left, top: place.top, width: place.width }}
		>
			<div className="authorship-card-head">
				<AuthorFace author={author} size={22} />
				<strong>{authorName(author)}</strong>
				<span className="authorship-pill" data-type={author?.type ?? "unknown"}>
					{author?.type === "agent" ? "Agent" : author?.type === "human" ? "Person" : "System"}
				</span>
				<span className="authorship-when">{ago(block.at)}</span>
			</div>
			<div className="authorship-card-body">
				{!author
					? <p>Written before authorship was recorded.</p>
					: (
						<>
							{(detail || latest) && (
								<p className="authorship-detail">
									{detail}
									{detail && latest ? " · " : ""}
									{latest && `rev ${latest.fromRevision} → ${latest.toRevision}`}
								</p>
							)}
							{changed
								? (
									<p className="authorship-words">
										{changed.map((piece, index) =>
											piece.kind === "same"
												? <span key={index}>{piece.text}</span>
												: piece.kind === "added"
												? (
													<span key={index}>
														{changed[index - 1]?.kind === "removed" ? " " : ""}
														<ins>{piece.text}</ins>
													</span>
												)
												: <del key={index}>{piece.text}</del>
										)}
									</p>
								)
								: latest?.kind === "added"
								? <p className="authorship-detail">Added this block.</p>
								: <p className="authorship-detail">This block is too long to compare here.</p>}
						</>
					)}
			</div>
			{block.history.length > 0 && (
				<div className="authorship-history">
					<p className="authorship-heading">
						History of this block{block.contributors > 1
							? ` · ${block.contributors} contributors`
							: ""}
					</p>
					<ol>
						{block.history.map((item, index) => (
							<li key={index}>
								<AuthorFace author={item.author} badge={false} size={16} />
								<span>{contribution(item)}</span>
								<time dateTime={item.at}>{when(item.at)}</time>
							</li>
						))}
					</ol>
				</div>
			)}
			{canEdit && block.restorable && (
				<div className="authorship-actions">
					<button
						aria-busy={restoring}
						className="btn btn-sm btn-outline"
						disabled={restoring}
						onClick={() => void store.restore(block.index, block.anchor.digest)}
						type="button"
					>
						{previous
							? `Restore ${authorName(previous.author)}'s version`
							: "Restore previous version"}
					</button>
				</div>
			)}
		</div>
	);
}
