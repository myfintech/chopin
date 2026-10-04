import { describe, expect, it } from "bun:test";

import { PostgresStorage } from "../storage/postgres/adapter";

let url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("postgres preferences", () => {
	it("defaults to system and upserts the theme", async () => {
		let storage = new PostgresStorage(url!);
		try {
			await storage.migrate();
			let now = new Date();
			let id = `U_preferences_${crypto.randomUUID()}`;
			await storage.users.put({ id, login: "octocat", avatarUrl: "avatar", now });
			expect(await storage.preferences.get(id)).toEqual({ theme: "system" });
			expect(await storage.preferences.setTheme(id, "dark", now)).toEqual({ theme: "dark" });
			expect(await storage.preferences.setTheme(id, "light", now)).toEqual({ theme: "light" });
			expect(await storage.preferences.get(id)).toEqual({ theme: "light" });
		} finally {
			await storage.close();
		}
	});
});
