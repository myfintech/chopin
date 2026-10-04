import { LineIcon } from "./icon";

import type { IconProps } from "./icon";

export function SunIcon(props: IconProps) {
	return (
		<LineIcon title="sun" {...props}>
			<circle cx="9" cy="9" r="3.25" />
			<path d="M9 1.75v1.5M9 14.75v1.5M3.873 3.873l1.061 1.061M13.066 13.066l1.061 1.061M1.75 9h1.5M14.75 9h1.5M3.873 14.127l1.061-1.061M13.066 4.934l1.061-1.061" />
		</LineIcon>
	);
}

export function MoonIcon(props: IconProps) {
	return (
		<LineIcon title="moon" {...props}>
			<path d="M13.5 11.25A5.75 5.75 0 0 1 6.75 4.5c0-.986.248-1.914.685-2.725A6.75 6.75 0 1 0 16.225 10.565 5.72 5.72 0 0 1 13.5 11.25Z" />
		</LineIcon>
	);
}

export function MonitorIcon(props: IconProps) {
	return (
		<LineIcon title="monitor" {...props}>
			<rect height="9.5" rx="2" width="14.5" x="1.75" y="2.75" />
			<path d="M6.25 15.25h5.5M9 12.25v3" />
		</LineIcon>
	);
}
