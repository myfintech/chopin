import { StorageError } from "../storage/errors";
import { isThemePreference } from "./model";

import type { HostedAuth } from "../auth/routes";
import type { Router } from "../http/router";
import type { StorageAdapter } from "../storage/port";

const BODY_LIMIT = 1_024;

function json(value: unknown, status = 200): Response {
	return Response.json(value, {
		status,
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
			"x-content-type-options": "nosniff",
		},
	});
}

function failure(err: unknown): Response {
	if (err instanceof StorageError && err.failure === "unavailable") {
		return json({ error: "storage is unavailable" }, 503);
	}
	return json({ error: "preference storage failed" }, 500);
}

async function body(request: Request): Promise<Record<string, unknown> | undefined> {
	let source = await request.text();
	if (new TextEncoder().encode(source).length > BODY_LIMIT) return undefined;
	try {
		let value = JSON.parse(source) as unknown;
		return value && typeof value === "object" && !Array.isArray(value)
			? value as Record<string, unknown>
			: undefined;
	} catch {
		return undefined;
	}
}

/** The signed-in user's interface preferences. They carry no repository authority. */
export function registerPreferenceRoutes(
	router: Router,
	auth: HostedAuth,
	options: { storage?: StorageAdapter } = {},
): void {
	let storage = options.storage ?? auth.storage;

	router.on("GET", "/api/preferences", async request => {
		try {
			let session = await auth.sessions.authenticate(request);
			if (!session) return json({ error: "authentication required" }, 401);
			return json(await storage.preferences.get(session.user.id));
		} catch (err) {
			return failure(err);
		}
	});

	router.on("PATCH", "/api/preferences", async request => {
		if (request.headers.get("origin") !== auth.config.origin) {
			return json({ error: "origin is not allowed" }, 403);
		}
		try {
			let session = await auth.sessions.authenticate(request);
			if (!session) return json({ error: "authentication required" }, 401);
			let theme = (await body(request))?.theme;
			if (!isThemePreference(theme)) {
				return json({ error: "theme must be light, dark, or system" }, 400);
			}
			return json(await storage.preferences.setTheme(session.user.id, theme, auth.clock()));
		} catch (err) {
			return failure(err);
		}
	});
}
