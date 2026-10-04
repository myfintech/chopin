import { AsyncLocalStorage } from "node:async_hooks";

import type { ToolSet } from "ai";
import type { Socket } from "../wire";
import type { Actor, Person, Via } from "./model";

/**
 * Who is acting, carried through async work instead of through every caller.
 *
 * Server-applied document changes arrive through about twenty call sites, so
 * attribution rides on AsyncLocalStorage set at the few places an actor is
 * known. Agent scopes are set where agent work starts and again around every
 * Planner tool, so an agent edit is never credited to a person. A human scope
 * lapses when its socket handler settles, so work it merely started cannot
 * inherit it; anything without a live scope is attributed to the system.
 */
type Scope = { actor: Actor; via: Via; active: boolean };

const scopes = new AsyncLocalStorage<Scope>();
const SYSTEM: Actor = { type: "system", kind: "server" };

/** Socket frames whose document changes are a person's own decision. */
const HUMAN_FRAMES = new Set([
	"question:edit",
	"question:discard",
	"question:reopen",
	"question:submit",
	"question:cancel",
	"question:option",
	"conversation-plan:correct",
	"conversation-plan:scoped-choice-save",
]);
/** Document updates are the only large frames and never need a human scope. */
const FRAME_SCAN_LIMIT = 64 * 1024;

export function enabled(): boolean {
	return process.env.DOCUMENT_PROVENANCE === "on";
}

export function current(): { actor: Actor; via: Via } {
	let scope = scopes.getStore();
	return scope?.active ? { actor: scope.actor, via: scope.via } : { actor: SYSTEM, via: "server" };
}

export function within<T>(actor: Actor, via: Via, run: () => T): T {
	if (!enabled()) return run();
	return scopes.run({ actor, via, active: true }, run);
}

function user(data: Socket["data"]): Actor {
	return { type: "human", kind: "user", id: data.principalId, handle: data.handle };
}

/** Wrap a browser batch commit so it is credited to the socket that sent it. */
export function browser<A extends unknown[], R>(
	ws: Socket,
	run: (...args: A) => R,
): (...args: A) => R {
	return (...args) => within(user(ws.data), "browser", () => run(...args));
}

/** Run one socket frame, in a lapsing human scope when the frame is a person's decision. */
export function receive(
	ws: Socket,
	raw: string,
	run: (ws: Socket, raw: string) => Promise<void>,
): Promise<void> {
	if (!enabled() || raw.length > FRAME_SCAN_LIMIT) return run(ws, raw);
	let kind: unknown;
	try {
		kind = (JSON.parse(raw) as { kind?: unknown }).kind;
	} catch {
		return run(ws, raw);
	}
	if (typeof kind !== "string" || !HUMAN_FRAMES.has(kind)) return run(ws, raw);
	let scope: Scope = { actor: user(ws.data), via: "server", active: true };
	return scopes.run(scope, () => run(ws, raw)).finally(() => {
		scope.active = false;
	});
}

type LooseTurn = [
	context: unknown,
	handle: string,
	text: unknown,
	thread: unknown,
	claimant: unknown,
	reserved?: unknown,
	member?: { userId?: string },
	references?: unknown,
	job?: { job?: { kind?: string } },
];

/** Wrap the chat turn runner so the turn, and anything it awaits, is the Planner's. */
export function plannerTurn<F extends (...args: never[]) => Promise<unknown>>(run: F): F {
	return ((...args: Parameters<F>) => {
		let [, handle, , , , , member, , job] = args as unknown as LooseTurn;
		let kind = job?.job?.kind;
		let actor: Actor = {
			type: "agent",
			kind: "planner",
			...(kind
				? { job: kind }
				: { requestedBy: { handle, ...(member?.userId ? { id: member.userId } : {}) } }),
		};
		return within(actor, "server", () => run(...args));
	}) as F;
}

/** Wrap a function whose document changes are Planner output outside a tool call. */
export function plannerAuthored<A extends unknown[], R>(
	run: (...args: A) => R,
): (...args: A) => R {
	return (...args) => within(planner(), "server", () => run(...args));
}

function planner(): Actor {
	let scope = scopes.getStore();
	return scope?.active && scope.actor.kind === "planner"
		? scope.actor
		: { type: "agent", kind: "planner" };
}

/**
 * Every Planner tool runs in a Planner scope.
 *
 * Harness adapters may invoke tools from callbacks registered when a session
 * opened, which can carry whatever scope opened it; the tool boundary is the
 * one place every Planner edit is guaranteed to pass.
 */
export function agentTools(tools: ToolSet): ToolSet {
	if (!enabled()) return tools;
	return Object.fromEntries(
		Object.entries(tools).map(([name, tool]) => {
			let execute = tool.execute;
			if (!execute) return [name, tool];
			return [name, {
				...tool,
				execute: (...args: Parameters<typeof execute>) =>
					within(planner(), "server", () => execute(...args)),
			}];
		}),
	) as ToolSet;
}

/** Wrap an MCP operation so it is credited to the coding agent and its GitHub user. */
export function codingAgent<A extends unknown[], R>(
	caller: { id: string; login: string },
	client: { name: string; version: string } | undefined,
	run: (...args: A) => R,
): (...args: A) => R {
	let person: Person = { id: caller.id, handle: caller.login };
	let actor: Actor = {
		type: "agent",
		kind: "coding-agent",
		user: person,
		...(client ? { client: { name: client.name, version: client.version } } : {}),
	};
	return (...args) => within(actor, "mcp", () => run(...args));
}
