/**
 * Operator configuration for extra Planner tools: remote or stdio MCP servers,
 * skills, and instructions. Read once from the file named by
 * `PLANNER_EXTENSIONS`; without it, the Planner keeps upstream's fixed tool set.
 *
 * Every configured server uses one set of operator credentials, so any admitted
 * repository writer who invokes the Planner can read whatever those credentials
 * reach. Configured tools must be read-only.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const SKILL_TOOL_NAME = "read_skill";

/** Provider-safe tool name limit shared by Copilot and Pi model APIs. */
const MAX_TOOL_NAME = 64;
const MAX_SKILL_FILES = 50;
const MAX_SKILL_FILE_BYTES = 256 * 1024;

let serverName = z.string().regex(
	/^[a-z][a-z0-9-]{0,23}$/,
	"server names are lowercase letters, digits, and hyphens, starting with a letter",
);
let remoteToolName = z.string().regex(/^[A-Za-z0-9_.-]{1,48}$/);
let text = z.record(z.string(), z.string());

let transportSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.enum(["http", "sse"]),
		url: z.string().url(),
		headers: text.optional(),
	}).strict(),
	z.object({
		type: z.literal("stdio"),
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		env: text.optional(),
		cwd: z.string().optional(),
	}).strict(),
]);

let serverSchema = z.object({
	transport: transportSchema,
	tools: z.array(remoteToolName).min(1),
	instructions: z.string().optional(),
	repositories: z.array(z.string().regex(/^(\*|[^/\s]+\/(\*|[^/\s]+))$/)).min(1).optional(),
	timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
}).strict();

let fileSchema = z.object({
	instructions: z.string().optional(),
	mcpServers: z.record(serverName, serverSchema).optional(),
	skills: z.array(z.string().min(1)).optional(),
}).strict();

export type Transport =
	| { type: "http" | "sse"; url: string; headers?: Record<string, string> }
	| {
		type: "stdio";
		command: string;
		args?: string[];
		env?: Record<string, string>;
		cwd?: string;
	};

export type ExtensionTool = {
	/** The name the Planner sees: `<server>__<remote name>`. */
	name: string;
	/** The name the MCP server offers. */
	remote: string;
};

export type ExtensionServer = {
	name: string;
	transport: Transport;
	tools: ExtensionTool[];
	instructions?: string;
	repositories?: string[];
	timeoutMs: number;
};

export type Skill = {
	name: string;
	description: string;
	body: string;
	files: Map<string, string>;
};

export type ExtensionConfig = {
	source: string;
	instructions?: string;
	servers: ExtensionServer[];
	skills: Skill[];
};

/** Replaces `${NAME}` with the environment value, failing on a missing one so a
 * secret is never sent as a literal placeholder. */
function substitute(value: string, env: Record<string, string | undefined>, where: string): string {
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
		let found = env[name];
		if (found === undefined) {
			throw new Error(`${where} references environment variable ${name}, which is not set`);
		}
		return found;
	});
}

function substituteAll(
	values: Record<string, string> | undefined,
	env: Record<string, string | undefined>,
	where: string,
): Record<string, string> | undefined {
	if (!values) return undefined;
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [key, substitute(value, env, `${where}.${key}`)]),
	);
}

function frontmatter(source: string, where: string): { data: unknown; body: string } {
	let match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
	if (!match) throw new Error(`${where} must start with YAML frontmatter`);
	return { data: Bun.YAML.parse(match[1]!), body: source.slice(match[0].length).trim() };
}

let skillMetadata = z.object({
	name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
	description: z.string().min(1).max(1_024),
}).passthrough();

function readSkill(directory: string): Skill {
	let where = `skill ${directory}`;
	let entry = join(directory, "SKILL.md");
	if (!existsSync(entry)) throw new Error(`${where} has no SKILL.md`);
	let { data, body } = frontmatter(readFileSync(entry, "utf8"), `${where}/SKILL.md`);
	let parsed = skillMetadata.safeParse(data);
	if (!parsed.success) {
		throw new Error(`${where}/SKILL.md frontmatter is invalid: ${parsed.error.message}`);
	}
	let files = new Map<string, string>();
	let walk = (current: string): void => {
		for (let item of readdirSync(current, { withFileTypes: true })) {
			let path = join(current, item.name);
			if (item.isSymbolicLink()) continue;
			if (item.isDirectory()) {
				walk(path);
				continue;
			}
			let name = relative(directory, path).split(sep).join("/");
			if (name === "SKILL.md" || !item.isFile()) continue;
			if (statSync(path).size > MAX_SKILL_FILE_BYTES) {
				throw new Error(`${where} file ${name} exceeds ${MAX_SKILL_FILE_BYTES} bytes`);
			}
			files.set(name, readFileSync(path, "utf8"));
			if (files.size > MAX_SKILL_FILES) {
				throw new Error(`${where} has more than ${MAX_SKILL_FILES} supporting files`);
			}
		}
	};
	walk(directory);
	return { name: parsed.data.name, description: parsed.data.description, body, files };
}

/** Parses and validates one configuration file's text. Throws a sentence naming the problem. */
export function parseConfig(
	source: string,
	options: {
		path: string;
		env?: Record<string, string | undefined>;
		reserved?: readonly string[];
	},
): ExtensionConfig {
	let env = options.env ?? process.env;
	let base = dirname(options.path);
	let raw: unknown;
	try {
		raw = Bun.JSONC.parse(source);
	} catch (cause) {
		throw new Error(`PLANNER_EXTENSIONS file ${options.path} is not valid JSON`, { cause });
	}
	let parsed = fileSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`PLANNER_EXTENSIONS file ${options.path} is invalid: ${z.prettifyError(parsed.error)}`,
		);
	}
	let file = parsed.data;
	let taken = new Set(options.reserved ?? []);
	let claim = (name: string, where: string): void => {
		if (name.length > MAX_TOOL_NAME) {
			throw new Error(`${where} tool name ${name} is longer than ${MAX_TOOL_NAME} characters`);
		}
		if (taken.has(name)) throw new Error(`${where} tool name ${name} is already in use`);
		taken.add(name);
	};

	let servers: ExtensionServer[] = Object.entries(file.mcpServers ?? {}).map(([name, server]) => {
		let where = `mcpServers.${name}`;
		let declared = server.transport;
		let transport: Transport = declared.type === "stdio"
			? {
				type: "stdio",
				command: substitute(declared.command, env, `${where}.transport.command`),
				args: declared.args?.map((arg, index) =>
					substitute(arg, env, `${where}.transport.args[${index}]`)
				),
				env: substituteAll(declared.env, env, `${where}.transport.env`),
				cwd: declared.cwd
					? resolve(base, substitute(declared.cwd, env, `${where}.transport.cwd`))
					: undefined,
			}
			: {
				type: declared.type,
				url: substitute(declared.url, env, `${where}.transport.url`),
				headers: substituteAll(declared.headers, env, `${where}.transport.headers`),
			};
		if (new Set(server.tools).size !== server.tools.length) {
			throw new Error(`${where}.tools lists a tool more than once`);
		}
		let tools = server.tools.map(remote => {
			let exposed = `${name.replaceAll("-", "_")}__${remote.replaceAll(".", "_")}`;
			claim(exposed, where);
			return { name: exposed, remote };
		});
		return {
			name,
			transport,
			tools,
			instructions: server.instructions?.trim() || undefined,
			repositories: server.repositories,
			timeoutMs: server.timeoutMs ?? 15_000,
		};
	});

	let skills = (file.skills ?? []).map(path =>
		readSkill(isAbsolute(path) ? path : resolve(base, path))
	);
	let names = new Set<string>();
	for (let skill of skills) {
		if (names.has(skill.name)) throw new Error(`skill name ${skill.name} is used more than once`);
		names.add(skill.name);
	}
	if (skills.length > 0) claim(SKILL_TOOL_NAME, "skills");

	return {
		source: options.path,
		instructions: file.instructions?.trim() || undefined,
		servers,
		skills,
	};
}

/** Whether `server` applies to `repository` (`owner/name`), case-insensitively. */
export function appliesTo(
	server: Pick<ExtensionServer, "repositories">,
	repository: string,
): boolean {
	if (!server.repositories) return true;
	let [owner, name] = repository.toLowerCase().split("/");
	return server.repositories.some(pattern => {
		if (pattern === "*") return true;
		let [patternOwner, patternName] = pattern.toLowerCase().split("/");
		return patternOwner === owner && (patternName === "*" || patternName === name);
	});
}

let loaded: ExtensionConfig | null | undefined;

/**
 * The process configuration, loaded on first use. `reserved` names upstream's
 * built-in Planner tools so a configured tool cannot shadow one.
 */
export function extensionConfig(reserved: readonly string[] = []): ExtensionConfig | undefined {
	if (loaded !== undefined) return loaded ?? undefined;
	let path = process.env.PLANNER_EXTENSIONS;
	if (!path) {
		loaded = null;
		return undefined;
	}
	let absolute = resolve(path);
	let source: string;
	try {
		source = readFileSync(absolute, "utf8");
	} catch (cause) {
		throw new Error(`PLANNER_EXTENSIONS file ${absolute} cannot be read`, { cause });
	}
	loaded = parseConfig(source, { path: absolute, reserved });
	console.log(
		`[planner-extensions] ${absolute}: ${
			loaded.servers.map(server => `${server.name} (${server.tools.length} tools)`).join(", ")
			|| "no MCP servers"
		}; ${loaded.skills.length} skills`,
	);
	return loaded;
}

/** The extra tool names to append to the Planner's active set. */
export function extensionToolNames(reserved: readonly string[]): string[] {
	let config = extensionConfig(reserved);
	if (!config) return [];
	return [
		...config.servers.flatMap(server => server.tools.map(tool => tool.name)),
		...(config.skills.length > 0 ? [SKILL_TOOL_NAME] : []),
	];
}
