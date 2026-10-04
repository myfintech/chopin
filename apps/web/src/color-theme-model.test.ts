import { describe, expect, it } from "bun:test";

import { DEFAULT_THEME_PREFERENCE, isThemePreference, resolveTheme } from "./color-theme-model";
import { nextThemePreference } from "./theme-toggle";

describe("color theme", () => {
	it("defaults to the system theme", () => {
		expect(DEFAULT_THEME_PREFERENCE).toBe("system");
	});

	it("cycles light, dark, then system", () => {
		expect(nextThemePreference("light")).toBe("dark");
		expect(nextThemePreference("dark")).toBe("system");
		expect(nextThemePreference("system")).toBe("light");
	});

	it("resolves system from the operating system", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});

	it("accepts only known preferences", () => {
		expect(isThemePreference("dark")).toBe(true);
		expect(isThemePreference("sepia")).toBe(false);
		expect(isThemePreference(null)).toBe(false);
	});
});
