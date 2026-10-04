import { describe, expect, it } from "bun:test";

import { Admission } from "../auth/admission";
import { Sessions } from "../auth/session";
import { Router } from "../http/router";
import { MemoryStorage } from "../storage/memory/adapter";
import { registerPreferenceRoutes } from "./routes";

import type { HostedAuth } from "../auth/routes";
import type { GitHub } from "../github/client";

const ORIGIN = "https://chopin.test";

async function setup() {
	let now = new Date("2026-10-03T12:00:00.000Z");
	let storage = new MemoryStorage();
	await storage.users.put({ id: "U_octocat", login: "octocat", avatarUrl: "avatar", now });
	let sessions = new Sessions(storage, true, () => now);
	let issued = await sessions.issue("U_octocat", {
		accessToken: "ghu_user",
		accessExpiresIn: 28_800,
		refreshToken: "ghr_user",
		refreshExpiresIn: 15_897_600,
	});
	let github = {} as GitHub;
	let config = {
		origin: ORIGIN,
		appSlug: "chopin-test",
		clientId: "client-id",
		clientSecret: "client-secret",
		encryptionKey: new Uint8Array(32).fill(4),
	};
	let auth: HostedAuth = {
		config,
		storage,
		github,
		admission: new Admission(config, github, () => now.getTime()),
		sessions,
		clock: () => now,
	};
	let router = new Router();
	registerPreferenceRoutes(router, auth, { storage });
	return { router, cookie: issued.cookie.split(";", 1)[0]! };
}

function request(cookie: string | undefined, init: RequestInit = {}): Request {
	let headers = new Headers(init.headers);
	if (cookie) headers.set("cookie", cookie);
	return new Request(`${ORIGIN}/api/preferences`, { ...init, headers });
}

function save(cookie: string | undefined, body: unknown, origin = ORIGIN): Request {
	return request(cookie, {
		method: "PATCH",
		headers: { origin, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("preference routes", () => {
	it("requires authentication", async () => {
		let { router } = await setup();
		expect((await router.handle(request(undefined)))!.status).toBe(401);
		expect((await router.handle(save(undefined, { theme: "dark" })))!.status).toBe(401);
	});

	it("defaults the theme to system", async () => {
		let { router, cookie } = await setup();
		let response = await router.handle(request(cookie));
		expect(response!.status).toBe(200);
		expect(await response!.json()).toEqual({ theme: "system" });
	});

	it("saves the theme for later sessions", async () => {
		let { router, cookie } = await setup();
		let saved = await router.handle(save(cookie, { theme: "dark" }));
		expect(saved!.status).toBe(200);
		expect(await saved!.json()).toEqual({ theme: "dark" });
		expect(await (await router.handle(request(cookie)))!.json()).toEqual({ theme: "dark" });
	});

	it("rejects an unknown theme", async () => {
		let { router, cookie } = await setup();
		let response = await router.handle(save(cookie, { theme: "sepia" }));
		expect(response!.status).toBe(400);
		expect(await (await router.handle(request(cookie)))!.json()).toEqual({ theme: "system" });
	});

	it("rejects a cross-origin write", async () => {
		let { router, cookie } = await setup();
		let response = await router.handle(save(cookie, { theme: "dark" }, "https://evil.test"));
		expect(response!.status).toBe(403);
	});
});
