/**
 * How authorship is drawn, kept apart from the drawing so it can be tested.
 *
 * Two questions, two signals. Who wrote a block is the author's face, shown
 * where their run starts, and their colour. Whether a person or an agent wrote
 * it is the face's shape and the bar's texture: colour alone cannot carry it,
 * because a person and an agent can hash to the same one.
 */

import { color } from "../cursor";
import { matches } from "./store";

import type { Provenance } from "@chopin/protocol";
import type { Focus } from "./store";

export type Texture = "solid" | "dashed" | "faint";

export type Mark = {
	block: Provenance.Block;
	color: string;
	texture: Texture;
	/** The first block of a run by the same author for the same requester. */
	face: boolean;
	/** More than one author has changed this block. */
	multi: boolean;
	dimmed: boolean;
};

export type Share = { author: Provenance.Author; blocks: number; percent: number };

/** The Planner keeps the product's colour; everyone else takes their cursor's. */
export function authorColor(author: Provenance.Author | undefined): string {
	if (!author || author.type === "system") return "var(--color-text-quaternary)";
	if (author.type === "human") return color(author.handle);
	if (author.key === "agent:planner") return "var(--color-brand)";
	return color(author.key);
}

export function authorName(author: Provenance.Author | undefined): string {
	if (!author) return "Before history";
	if (author.type === "human") return `@${author.handle}`;
	if (author.type === "agent") return author.name;
	return "System";
}

/** Who an agent acted for, in words, or nothing for a person. */
export function onBehalf(author: Provenance.Author | undefined): string | undefined {
	if (author?.type !== "agent") return undefined;
	if (author.kind === "coding-agent") {
		let version = author.client ? ` (version ${author.client.version})` : "";
		return `Through MCP${version}${author.for ? `, for @${author.for}` : ""}`;
	}
	if (author.for) return `Asked by @${author.for}`;
	if (author.job) return `Background work: ${author.job.replaceAll("-", " ")}`;
	return undefined;
}

function run(author: Provenance.Author | undefined): string {
	if (!author) return "";
	return author.type === "agent" ? `${author.key}|${author.for ?? author.job ?? ""}` : author.key;
}

export function marks(blocks: Provenance.Block[], focus: Focus | undefined): Mark[] {
	let ordered = [...blocks].sort((a, b) => a.index - b.index);
	return ordered.map((block, position) => {
		let previous = ordered[position - 1];
		let adjacent = previous !== undefined && previous.index === block.index - 1;
		return {
			block,
			color: authorColor(block.author),
			texture: block.author?.type === "agent"
				? "dashed"
				: block.author?.type === "human"
				? "solid"
				: "faint",
			face: !!block.author && (!adjacent || run(previous.author) !== run(block.author)),
			multi: block.contributors > 1,
			dimmed: !matches(block.author, focus),
		};
	});
}

/** Each contributor's share of the current document, largest first. */
export function shares(reply: Provenance.Authorship.Reply): Share[] {
	let total = reply.untracked + reply.contributors.reduce((sum, item) => sum + item.characters, 0);
	return reply.contributors.map(item => ({
		author: item.author,
		blocks: item.blocks,
		percent: total === 0 ? 0 : Math.round((item.characters / total) * 100),
	}));
}

/** All agents together, for the one control that answers "what did agents write?". */
export function agentShare(reply: Provenance.Authorship.Reply): Share | undefined {
	let all = shares(reply).filter(item => item.author.type === "agent");
	if (all.length === 0) return undefined;
	return {
		author: all[0]!.author,
		blocks: all.reduce((sum, item) => sum + item.blocks, 0),
		percent: all.reduce((sum, item) => sum + item.percent, 0),
	};
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
	["second", 60],
	["minute", 60],
	["hour", 24],
	["day", 7],
	["week", 4.35],
	["month", 12],
	["year", Number.POSITIVE_INFINITY],
];

export function ago(iso: string | undefined, now = Date.now()): string {
	if (!iso) return "";
	let value = (Date.parse(iso) - now) / 1000;
	for (let [unit, size] of STEPS) {
		if (Math.abs(value) < size) return RELATIVE.format(Math.round(value), unit);
		value /= size;
	}
	return "";
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function day(value: Date): number {
	return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** A calendar time for a history row: today, yesterday, this week, or a date. */
export function when(iso: string, now = new Date()): string {
	let at = new Date(iso);
	let days = Math.round((day(now) - day(at)) / 86_400_000);
	if (days === 0) return `Today ${CLOCK.format(at)}`;
	if (days === 1) return `Yesterday ${CLOCK.format(at)}`;
	if (days > 1 && days < 7) return `${WEEKDAY.format(at)} ${CLOCK.format(at)}`;
	return DATE.format(at);
}

/** One history row's words, naming who an agent acted for. */
export function contribution(item: Provenance.Contribution): string {
	let name = authorName(item.author);
	let asker = item.author.type === "agent" && item.author.for ? `, for @${item.author.for}` : "";
	return `${name}${asker}, ${verb(item.kind)}`;
}

export function verb(kind: Provenance.ChangeKind): string {
	switch (kind) {
		case "added":
			return "added";
		case "modified":
			return "edited";
		case "moved":
			return "moved";
		case "removed":
			return "removed";
	}
}
