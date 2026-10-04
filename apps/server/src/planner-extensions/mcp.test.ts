import { afterEach, describe, expect, it } from "bun:test";
import { jsonSchema, tool } from "ai";

import { instructionsFor, skillTool } from ".";
import { closeConnections, MAX_OUTPUT_CHARS, outputText, serverTools } from "./mcp";

import type { ToolSet } from "ai";
import type { ExtensionConfig, ExtensionServer } from "./config";
import type { CreateClient } from "./mcp";

afterEach(closeConnections);

let server = (name: string, overrides: Partial<ExtensionServer> = {}): ExtensionServer => ({
	name,
	transport: { type: "http", url: "https://mcp.example.test" },
	tools: [{ name: `${name}__search`, remote: "search" }],
	timeoutMs: 1_000,
	callTimeoutMs: 60_000,
	...overrides,
});

function fakeClient(offered: ToolSet, calls: unknown[] = []): CreateClient {
	return async config => {
		calls.push(config);
		return { tools: async () => offered, close: async () => {} };
	};
}

let remoteSearch = tool({
	description: "Search everything.",
	inputSchema: jsonSchema({ type: "object", properties: { query: { type: "string" } } }),
	execute: async (input: unknown) => ({
		content: [{ type: "text", text: `found ${(input as { query: string }).query}` }],
	}),
});

let context = (allowed: boolean) => ({
	context: { owner: { revalidate: async () => allowed } },
	toolCallId: "1",
	messages: [],
});

describe("serverTools", () => {
	it("exposes only allowlisted tools, under their namespaced names", async () => {
		let tools = await serverTools(
			[server("ctx")],
			"o/r",
			fakeClient({ search: remoteSearch, delete_everything: remoteSearch }),
		);
		expect(Object.keys(tools)).toEqual(["ctx__search"]);
		let output = await tools.ctx__search!.execute!({ query: "plans" }, context(true) as never);
		expect(output).toBe("found plans");
	});

	it("ends a call the server never answers, then reconnects for the next one", async () => {
		let opened = 0;
		let hanging = tool({
			description: "Never answers.",
			inputSchema: jsonSchema({ type: "object" }),
			execute: () => new Promise(() => {}),
		});
		let createClient: CreateClient = async () => {
			opened++;
			return { tools: async () => ({ search: hanging }), close: async () => {} };
		};
		let tools = await serverTools([server("slow", { callTimeoutMs: 50 })], "o/r", createClient);
		let started = Date.now();
		let output = await tools.slow__search!.execute!({}, context(true) as never);
		expect(output).toContain("did not answer within");
		expect(Date.now() - started).toBeLessThan(1_000);
		await serverTools([server("slow", { callTimeoutMs: 50 })], "o/r", createClient);
		expect(opened).toBe(2);
	});

	it("propagates a turn abort instead of reporting it as a tool error", async () => {
		let hanging = tool({
			description: "Never answers.",
			inputSchema: jsonSchema({ type: "object" }),
			execute: () => new Promise(() => {}),
		});
		let tools = await serverTools([server("slow")], "o/r", fakeClient({ search: hanging }));
		let turn = new AbortController();
		let call = tools.slow__search!.execute!(
			{},
			{ ...context(true), abortSignal: turn.signal } as never,
		);
		turn.abort(new Error("turn aborted"));
		await expect(call).rejects.toThrow("turn aborted");
	});

	it("rechecks the Planner owner before every call", async () => {
		let tools = await serverTools([server("ctx")], "o/r", fakeClient({ search: remoteSearch }));
		let output = await tools.ctx__search!.execute!({ query: "plans" }, context(false) as never);
		expect(output).toContain("no longer authorized");
	});

	it("skips servers scoped to other repositories and never connects to them", async () => {
		let calls: unknown[] = [];
		let tools = await serverTools(
			[server("ctx", { repositories: ["elsewhere/*"] })],
			"o/r",
			fakeClient({ search: remoteSearch }, calls),
		);
		expect(tools).toEqual({});
		expect(calls).toHaveLength(0);
	});

	it("leaves an unavailable server out instead of failing the session", async () => {
		let tools = await serverTools([server("down")], "o/r", async () => {
			throw new Error("connection refused");
		});
		expect(tools).toEqual({});
	});

	it("skips protocol discovery only for stdio servers, which may still be starting", async () => {
		let calls: Array<{ protocolVersionDiscovery?: boolean }> = [];
		let stdio = server("local", {
			transport: { type: "stdio", command: "npx", args: ["-y", "some-server"] },
		});
		await serverTools(
			[stdio, server("remote")],
			"o/r",
			fakeClient({ search: remoteSearch }, calls),
		);
		expect(calls.map(call => call.protocolVersionDiscovery).sort()).toEqual([false, true]);
	});

	it("keeps a connection whose opening reported a stray protocol error", async () => {
		let opened = 0;
		let createClient: CreateClient = async config => {
			opened++;
			return {
				tools: async () => {
					config.onUncaughtError?.(new Error("response for an unknown message ID"));
					return { search: remoteSearch };
				},
				close: async () => {},
			};
		};
		let first = await serverTools([server("ctx")], "o/r", createClient);
		let second = await serverTools([server("ctx")], "o/r", createClient);
		expect(Object.keys(first)).toEqual(["ctx__search"]);
		expect(Object.keys(second)).toEqual(["ctx__search"]);
		expect(opened).toBe(1);
	});

	it("refuses redirects on remote transports", async () => {
		let calls: Array<{ transport: { redirect?: string } }> = [];
		await serverTools([server("ctx")], "o/r", fakeClient({ search: remoteSearch }, calls));
		expect(calls[0]!.transport.redirect).toBe("error");
	});
});

describe("outputText", () => {
	it("joins text content, marks errors, and bounds length", () => {
		expect(outputText({ content: [{ type: "text", text: "a" }, { type: "image" }] })).toBe(
			"a\n\n[image content omitted]",
		);
		expect(outputText({ content: [{ type: "text", text: "nope" }], isError: true })).toBe(
			"Error: nope",
		);
		expect(outputText({ content: [], structuredContent: { id: 1 } })).toContain('"id": 1');
		let long = outputText({ content: [{ type: "text", text: "x".repeat(MAX_OUTPUT_CHARS + 10) }] });
		expect(long).toContain("[Output truncated");
	});
});

describe("skills and instructions", () => {
	let config: ExtensionConfig = {
		source: "/c.json",
		instructions: "Always start with Unblocked.",
		servers: [server("unblocked"), server("jira", { repositories: ["other/*"] })],
		skills: [{
			name: "briefs",
			description: "Find a project brief.",
			body: "Search Notion.",
			files: new Map([["fields.md", "Owner"]]),
		}],
	};

	it("describes only servers for the repository, then skills, then operator instructions", () => {
		let text = instructionsFor(config, "o/r")!;
		expect(text).toContain("`unblocked__search`");
		expect(text).not.toContain("jira__search");
		expect(text).toContain("`briefs`: Find a project brief.");
		expect(text.indexOf("Always start with Unblocked.")).toBeGreaterThan(text.indexOf("briefs"));
		expect(text).toContain("untrusted evidence");
	});

	it("reads a skill body and its supporting files", async () => {
		let read = skillTool(config.skills);
		let options = { toolCallId: "1", messages: [], context: {} } as never;
		expect(await read.execute!({ name: "briefs" }, options)).toContain("fields.md");
		expect(await read.execute!({ name: "briefs", file: "fields.md" }, options)).toBe("Owner");
		expect(await read.execute!({ name: "briefs", file: "../x" }, options)).toContain("Error");
	});
});
