/*
 * The user's colour theme.
 *
 * The saved preference lives on the server and follows the user to every
 * sign-in. A copy in local storage only paints the first frame in the right
 * scheme before that answer arrives; both sign-in paths reload the page, so
 * reading the server once at startup covers every login.
 */

import { useSyncExternalStore } from "react";

import { applyThemePreference, cachedThemePreference, THEME_STORAGE_KEY } from "./color-theme-boot";
import { DEFAULT_THEME_PREFERENCE, isThemePreference } from "./color-theme-model";

import type { ThemePreference } from "./color-theme-model";

let started = false;
let preference: ThemePreference = DEFAULT_THEME_PREFERENCE;
let listeners = new Set<() => void>();
// Bumped by every local choice, so a slower startup read cannot undo one.
let revision = 0;
let saving = Promise.resolve();

function adopt(value: ThemePreference): void {
	preference = value;
	try {
		localStorage.setItem(THEME_STORAGE_KEY, value);
	} catch {
		// The server copy is authoritative; a blocked cache only costs the first frame.
	}
	applyThemePreference(value);
	for (let listener of listeners) listener();
}

async function load(): Promise<void> {
	let begun = revision;
	try {
		let response = await fetch("/api/preferences", { headers: { accept: "application/json" } });
		// Signed out: keep the cached choice for the sign-in page.
		if (!response.ok) return;
		let value = (await response.json() as { theme?: unknown }).theme;
		if (revision === begun && isThemePreference(value)) adopt(value);
	} catch {
		// Offline or not served by Chopin; the cached choice stands.
	}
}

function save(value: ThemePreference): void {
	// Serialized so the last choice is also the last write.
	saving = saving.then(async () => {
		try {
			let response = await fetch("/api/preferences", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ theme: value }),
			});
			if (!response.ok) console.warn(`chopin: could not save theme (${response.status})`);
		} catch (err) {
			console.warn("chopin: could not save theme", err);
		}
	});
}

export function setThemePreference(value: ThemePreference): void {
	revision += 1;
	adopt(value);
	save(value);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useThemePreference(): ThemePreference {
	return useSyncExternalStore(subscribe, () => preference, () => preference);
}

/** Follows the system and adopts the saved preference. */
export function startColorTheme(): void {
	if (started) return;
	started = true;
	preference = cachedThemePreference() ?? DEFAULT_THEME_PREFERENCE;
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		if (preference === "system") applyThemePreference(preference);
	});
	void load();
}
