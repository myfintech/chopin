import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { jsonSchema, tool } from "ai";
import { z } from "zod";

import { appliesTo } from "./config";

import type { MCPClientConfig } from "@ai-sdk/mcp";
import type { Tool, ToolSet } from "ai";
import type { ActiveOwnerBinding } from "../agent/active-owner";
import type { ExtensionServer, ExtensionTool } from "./config";

/** Bound on the text returned to the model from one call. */
export const MAX_OUTPUT_CHARS = 60_000;
/** A failed connection is retried by a later session, not by every one. */
const RETRY_AFTER_MS = 30_000;

type MinimalClient = {
	tools(): Promise<ToolSet>;
	close(): Promise<void>;
};

export type CreateClient = (config: MCPClientConfig) => Promise<MinimalClient>;

type Connection = {
	client?: MinimalClient;
	tools?: Map<string, Tool>;
	opening?: Promise<Map<string, Tool> | undefined>;
	failedAt?: number;
};

const connections = new Map<string, Connection>();

function connectionFor(server: ExtensionServer): Connection {
	let found = connections.get(server.name);
	if (!found) connections.set(server.name, found = {});
	return found;
}

async function closeQuietly(client: MinimalClient | undefined): Promise<void> {
	try {
		await client?.close();
	} catch {
		// A client that already lost its transport has nothing left to close.
	}
}

function invalidate(server: ExtensionServer, connection: Connection, cause: unknown): void {
	if (connections.get(server.name) !== connection) return;
	connections.delete(server.name);
	void closeQuietly(connection.client);
	console.error(`[planner-extensions] ${server.name} connection dropped:`, cause);
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

/**
 * Opens, or reuses, the process-wide client for `server` and returns its
 * allowlisted tools keyed by remote name. Every tool the server offers that is
 * not in the allowlist is dropped. Never throws; an unavailable server yields
 * `undefined` and is retried after a pause.
 */
export async function connect(
	server: ExtensionServer,
	createClient: CreateClient = createMCPClient as CreateClient,
): Promise<Map<string, Tool> | undefined> {
	let connection = connectionFor(server);
	if (connection.tools) return connection.tools;
	if (connection.opening) return connection.opening;
	if (connection.failedAt && Date.now() - connection.failedAt < RETRY_AFTER_MS) return undefined;
	connection.opening = (async () => {
		let client: MinimalClient | undefined;
		try {
			let transport = server.transport.type === "stdio"
				? new StdioMCPTransport({
					command: server.transport.command,
					args: server.transport.args,
					env: server.transport.env,
					cwd: server.transport.cwd,
					stderr: "inherit",
				})
				: { ...server.transport, redirect: "error" as const };
			client = await withTimeout(
				createClient({
					transport,
					name: "chopin-planner",
					// A stdio server that is still starting (an `npx` or `uvx` download) can
					// miss the client's 1 s `server/discover` probe and answer it after the
					// fallback `initialize`; that stray reply is an uncaught protocol error.
					protocolVersionDiscovery: server.transport.type !== "stdio",
					// `connect` handles failures while opening; only an established
					// connection is dropped and reopened.
					onUncaughtError: cause => {
						if (connection.client) invalidate(server, connection, cause);
						else console.error(`[planner-extensions] ${server.name} error while opening:`, cause);
					},
				}),
				server.timeoutMs,
				`${server.name} connection`,
			);
			let offered = await withTimeout(client.tools(), server.timeoutMs, `${server.name} tools`);
			let picked = new Map<string, Tool>();
			let missing: string[] = [];
			for (let { remote } of server.tools) {
				let found = offered[remote];
				if (found?.execute) picked.set(remote, found);
				else missing.push(remote);
			}
			if (missing.length > 0) {
				console.error(
					`[planner-extensions] ${server.name} does not offer ${missing.join(", ")}; offered: ${
						Object.keys(offered).sort().join(", ") || "none"
					}`,
				);
			}
			console.log(
				`[planner-extensions] ${server.name} connected: ${[...picked.keys()].join(", ") || "none"}`,
			);
			connection.client = client;
			connection.tools = picked;
			connection.failedAt = undefined;
			return picked;
		} catch (cause) {
			await closeQuietly(client);
			connection.failedAt = Date.now();
			console.error(`[planner-extensions] ${server.name} is unavailable:`, cause);
			return undefined;
		} finally {
			connection.opening = undefined;
		}
	})();
	return connection.opening;
}

/** Flattens an MCP `CallToolResult` into bounded text for the model. */
export function outputText(result: unknown): string {
	let value = result as {
		content?: Array<{ type: string; text?: string }>;
		structuredContent?: unknown;
		isError?: boolean;
		toolResult?: unknown;
	} | null;
	let parts: string[] = [];
	for (let item of value?.content ?? []) {
		parts.push(
			item.type === "text" && typeof item.text === "string"
				? item.text
				: `[${item.type} content omitted]`,
		);
	}
	if (parts.length === 0) {
		let structured = value?.structuredContent ?? value?.toolResult ?? result;
		parts.push(typeof structured === "string" ? structured : JSON.stringify(structured, null, 2));
	}
	let text = parts.join("\n\n");
	if (text.length > MAX_OUTPUT_CHARS) {
		text = `${
			text.slice(0, MAX_OUTPUT_CHARS)
		}\n\n[Output truncated at ${MAX_OUTPUT_CHARS} characters.]`;
	}
	return value?.isError ? `Error: ${text}` : text;
}

let contextSchema = z.object({
	owner: z.custom<Pick<ActiveOwnerBinding, "revalidate">>(),
});

const openSchema = jsonSchema({ type: "object", properties: {}, additionalProperties: true });

/** A tool that tells the model why it cannot be used, rather than throwing. */
export function unavailableTool(name: string, reason: string): Tool {
	return tool({
		description: `${name} (unavailable: ${reason})`,
		inputSchema: openSchema,
		execute: async (): Promise<string> => `Error: ${name} is unavailable: ${reason}.`,
	}) as Tool;
}

/**
 * One Planner-facing tool. It rechecks the Planner owner before every call and
 * resolves the remote tool at call time, so a reconnect between turns is
 * transparent to an open session.
 */
function boundTool(
	server: ExtensionServer,
	entry: ExtensionTool,
	source: Tool,
	createClient: CreateClient | undefined,
): Tool {
	return tool({
		description: source.description ?? `${entry.remote} from ${server.name}.`,
		inputSchema: source.inputSchema,
		contextSchema,
		execute: async (input, options) => {
			let context = options.context as z.infer<typeof contextSchema>;
			if (!await context.owner.revalidate()) {
				return "Error: the Planner owner is no longer authorized for this repository.";
			}
			let current = (await connect(server, createClient))?.get(entry.remote);
			if (!current?.execute) return `Error: ${server.name} is unavailable right now.`;
			let connection = connections.get(server.name);
			let timeout = AbortSignal.timeout(server.callTimeoutMs);
			let signal = options.abortSignal ? AbortSignal.any([options.abortSignal, timeout]) : timeout;
			let call = Promise.resolve(current.execute(input, { ...options, abortSignal: signal }));
			// A client that ignores the signal must not hold the turn open either.
			call.catch(() => {});
			let stopped = new Promise<never>((_, reject) => {
				if (signal.aborted) reject(signal.reason);
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
			stopped.catch(() => {});
			try {
				return outputText(await Promise.race([call, stopped]));
			} catch (cause) {
				if (options.abortSignal?.aborted) throw cause;
				if (connection) invalidate(server, connection, cause);
				if (timeout.aborted) {
					return `Error: ${server.name} did not answer within ${
						Math.round(server.callTimeoutMs / 1000)
					} seconds. Continue without it or try a narrower request.`;
				}
				let message = cause instanceof Error ? cause.message : String(cause);
				return `Error: ${server.name} call failed: ${message}`;
			}
		},
	}) as Tool;
}

/**
 * Real tools for every configured server that applies to `repository`. Any tool
 * left out keeps its placeholder, which reports why it is unavailable.
 */
export async function serverTools(
	servers: readonly ExtensionServer[],
	repository: string,
	createClient?: CreateClient,
): Promise<ToolSet> {
	let tools: ToolSet = {};
	await Promise.all(servers.map(async server => {
		if (!appliesTo(server, repository)) return;
		let offered = await connect(server, createClient);
		if (!offered) return;
		for (let entry of server.tools) {
			let source = offered.get(entry.remote);
			if (source) tools[entry.name] = boundTool(server, entry, source, createClient);
		}
	}));
	return tools;
}

export async function closeConnections(): Promise<void> {
	let open = [...connections.values()];
	connections.clear();
	await Promise.all(open.map(connection => closeQuietly(connection.client)));
}
