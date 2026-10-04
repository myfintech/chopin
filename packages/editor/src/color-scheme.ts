import { useSyncExternalStore } from "react";

export type ColorScheme = "light" | "dark";

/** The host resolves the user's preference onto `<html data-theme>`. */
function read(): ColorScheme {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(changed: () => void): () => void {
	let observer = new MutationObserver(changed);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
	return () => observer.disconnect();
}

/** Derived views that paint their own colours follow the page's resolved scheme. */
export function useColorScheme(): ColorScheme {
	return useSyncExternalStore(subscribe, read, () => "light");
}
