import { MonitorIcon, MoonIcon, SunIcon } from "@chopin/icons";

import { setThemePreference, useThemePreference } from "./color-theme";
import { THEME_PREFERENCES } from "./color-theme-model";

import type { ThemePreference } from "./color-theme-model";

const LABELS: Record<ThemePreference, string> = { light: "Light", dark: "Dark", system: "System" };

const ICONS: Record<ThemePreference, typeof SunIcon> = {
	light: SunIcon,
	dark: MoonIcon,
	system: MonitorIcon,
};

/** The toggle cycles light → dark → system → light. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
	return THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(current) + 1) % THEME_PREFERENCES.length]!;
}

/** Cycles the colour theme between light, dark and the operating system's. */
export function ThemeToggle() {
	let preference = useThemePreference();
	let next = nextThemePreference(preference);
	let Icon = ICONS[preference];
	return (
		<button
			aria-label={`Theme: ${LABELS[preference]}. Switch to ${LABELS[next]}`}
			className="theme-toggle"
			data-press="small"
			data-theme-toggle={preference}
			data-tooltip={`Theme: ${LABELS[preference]}`}
			onClick={() => setThemePreference(next)}
			type="button"
		>
			<Icon />
		</button>
	);
}
