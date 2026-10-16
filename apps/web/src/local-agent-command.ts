import { useEffect, useState } from "react";

import { session } from "./api";
import {
	chosenAgent,
	guessSystem,
	isSetupAgent,
	setupAgentCommand,
} from "./experiments/setup-commands";

import type { SetupAgent } from "@chopin/protocol/agents";
import type { SetupSystem } from "./experiments/setup-commands";

/** The Machines page's remembered coding agent pick (`AGENT_KEY` in experiments/machine-setup.tsx). */
const AGENT_KEY = "chopin:machines:agent";

export type LocalAgentCommand = {
	/** What to run in a terminal to connect this computer. */
	command: string;
	/** The coding agent it starts, when a setup agent replaces the built-in command. */
	agent?: string;
};

/**
 * The command that connects this computer, for the agent the Machines page would start on: the
 * person's last pick in this browser, else the deployment's default setup agent (CHOPIN_SETUP_AGENTS)
 * when it has a keyless command, else `builtIn`, the built-in connector command.
 */
export function localAgentCommand(
	origin: string,
	builtIn: string,
	{ setupAgents, stored, system }: {
		setupAgents: readonly SetupAgent[];
		stored: string | null;
		system: SetupSystem;
	},
): LocalAgentCommand {
	let agent = chosenAgent(stored, setupAgents, "computer");
	if (!isSetupAgent(agent)) return { command: builtIn };
	let command = setupAgentCommand(agent, system, { origin });
	return command ? { command, agent: agent.name } : { command: builtIn };
}

/** `localAgentCommand` for this browser; `builtIn` until the session answers. */
export function useLocalAgentCommand(origin: string, builtIn: string): LocalAgentCommand {
	let [setupAgents, setSetupAgents] = useState<SetupAgent[]>([]);
	useEffect(() => {
		let current = true;
		session().then(value => current && setSetupAgents(value.setupAgents ?? []), () => {});
		return () => {
			current = false;
		};
	}, []);
	return localAgentCommand(origin, builtIn, {
		setupAgents,
		stored: localStorage.getItem(AGENT_KEY),
		system: guessSystem(navigator.userAgent),
	});
}
