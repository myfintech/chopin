import { expect, test } from "bun:test";
import { localAgentCommand } from "./local-agent-command";
import { connectorCommand } from "./local-agent-note";

import type { SetupAgent } from "@chopin/protocol/agents";

const ORIGIN = "https://chopin.example";
const BUILT_IN = connectorCommand(ORIGIN);

const claude: SetupAgent = {
	id: "claude-code",
	name: "Claude Code",
	install: ["npm install -g @agentclientprotocol/claude-agent-acp"],
	command:
		"CHOPIN_URL={origin} CHOPIN_PAIRING_KEY={key} bun connector.js connect --name {name} -- claude-agent-acp",
	keyless: "CHOPIN_URL={origin} bun connector.js connect --name {name} -- claude-agent-acp",
	default: true,
};

let command = (setupAgents: SetupAgent[], stored: string | null = null) =>
	localAgentCommand(ORIGIN, BUILT_IN, { setupAgents, stored, system: "linux" });

test("without setup agents the note keeps the built-in connector command", () => {
	expect(command([])).toEqual({ command: BUILT_IN });
});

test("the deployment's default setup agent replaces the built-in command, keyless and unnamed", () => {
	expect(command([claude])).toEqual({
		command: "CHOPIN_URL=https://chopin.example bun connector.js connect -- claude-agent-acp",
		agent: "Claude Code",
	});
});

test("the person's own pick on the Machines page wins over the deployment's default", () => {
	expect(command([claude], "copilot")).toEqual({ command: BUILT_IN });
	expect(command([{ ...claude, default: false }], "claude-code").agent).toBe("Claude Code");
});

test("a setup agent without a keyless command can't connect this computer, so the built-in stays", () => {
	let { keyless: _, ...serverOnly } = claude;
	expect(command([serverOnly])).toEqual({ command: BUILT_IN });
});
