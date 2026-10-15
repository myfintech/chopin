import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicPlannerMode } from ".";
import { plannerInstructions } from "../agent/planner";
import { fullPlanner } from "../harness/atomic/full";
import { openPlannerSession } from "../harness/session";

import type { ActiveOwnerBinding } from "../agent/active-owner";

describe("atomicPlannerMode", () => {
	it("keeps upstream's full session unless ATOMIC_PLANNER is isolated", () => {
		expect(atomicPlannerMode({})).toBe("full");
		expect(atomicPlannerMode({ ATOMIC_PLANNER: "" })).toBe("full");
		expect(atomicPlannerMode({ ATOMIC_PLANNER: "full" })).toBe("full");
		expect(atomicPlannerMode({ ATOMIC_PLANNER: "isolated" })).toBe("isolated");
	});

	it("refuses any other value", () => {
		expect(() => atomicPlannerMode({ ATOMIC_PLANNER: "Isolated" })).toThrow(
			"ATOMIC_PLANNER must be full or isolated, not Isolated",
		);
	});
});

describe("an isolated Atomic Planner session", () => {
	let previous = { ...process.env };
	let roots: string[] = [];
	afterEach(async () => {
		for (let name of ["ATOMIC_PLANNER", "XDG_STATE_HOME"]) {
			if (previous[name] === undefined) delete process.env[name];
			else process.env[name] = previous[name];
		}
		for (let root of roots.splice(0)) await rm(root, { recursive: true, force: true });
	});

	/** Opens and streams one atomic Planner session, observing what the harness would see. */
	async function open() {
		let owner: ActiveOwnerBinding = {
			channelId: "channel",
			token: "test-token",
			repository: { id: "R_test", owner: "owner", name: "repo", defaultBranch: "main" },
			ownerSessionId: "owner-session",
			ownerGeneration: 1,
			credentialRevision: 1,
			expiresAt: new Date(Date.now() + 60_000),
			signal: new AbortController().signal,
			currentToken: () => "test-token",
			revalidate: async () => true,
			release() {},
		};
		let sessionId = "";
		let seen = { instructions: "", registered: false };
		let opened = await openPlannerSession(owner, {
			room: { id: "channel", plan: {}, server: {} } as never,
			repository: owner.repository,
			harness: "atomic",
			instructions: workspace => plannerInstructions("owner/repo", "BOOTSTRAP", workspace),
		}, {
			githubTools: async () => ({ ok: true, value: {} }),
			extensionTools: async () => ({}),
			createSandbox: async () => ({ destroy: async () => {} }) as never,
			registerCredential: () => () => {},
			agent: {
				createSession: async (options: { sessionId: string }) => {
					sessionId = options.sessionId;
					return { destroy: async () => {} };
				},
				stream: async (call: { options: { instructions: string } }) => {
					seen.instructions = call.options.instructions;
					seen.registered = fullPlanner(sessionId) !== undefined;
				},
			} as never,
		});
		if (!opened.ok) throw new Error("Planner unavailable");
		await opened.value.stream("prompt", new AbortController().signal);
		await opened.value.destroy();
		return seen;
	}

	it("registers no full session and gets the isolated instructions", async () => {
		process.env.ATOMIC_PLANNER = "isolated";
		let seen = await open();
		expect(seen.registered).toBe(false);
		expect(seen.instructions).toContain("You have no shell, checkout, host filesystem");
		expect(seen.instructions).not.toContain("Chat shows a card for each workflow run");
	});

	it("stays a full session without the setting, as upstream runs it", async () => {
		delete process.env.ATOMIC_PLANNER;
		let root = await mkdtemp(join(tmpdir(), "chopin-isolated-planner-"));
		roots.push(root);
		process.env.XDG_STATE_HOME = root;
		let seen = await open();
		expect(seen.registered).toBe(true);
		expect(seen.instructions).toContain("Chat shows a card for each workflow run");
	});
});
