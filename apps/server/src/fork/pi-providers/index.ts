/**
 * Operator-defined Pi model providers: models that Pi's built-in catalog does
 * not list, reached through a gateway Pi already speaks to. Read once from the
 * file named by `PI_PROVIDERS` and passed to `@ai-sdk/harness-pi` as its public
 * `providers` setting, which registers them before Pi resolves `MODEL`.
 * Without `PI_PROVIDERS`, the harness is unchanged. See docs/fork-pi-providers.md.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import { substitute } from "../planner-extensions/config";

import type { PiHarnessSettings } from "@ai-sdk/harness-pi";

/** Providers the harness registers from `HARNESS_AUTH`; a custom entry would replace their models. */
const RESERVED = new Set(["vercel-ai-gateway", "anthropic", "openai"]);

const API = z.enum([
	"anthropic-messages",
	"openai-completions",
	"openai-responses",
	"google-generative-ai",
]);

let price = z.number().min(0);
let costSchema = z.object({
	input: price,
	output: price,
	cacheRead: price,
	cacheWrite: price,
	tiers: z.array(
		z.object({
			inputTokensAbove: z.number().int().positive(),
			input: price,
			output: price,
			cacheRead: price,
			cacheWrite: price,
		}).strict(),
	).optional(),
}).strict();

let modelSchema = z.object({
	id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),
	name: z.string().min(1),
	api: API.optional(),
	reasoning: z.boolean(),
	input: z.array(z.enum(["text", "image"])).min(1),
	contextWindow: z.number().int().positive(),
	maxTokens: z.number().int().positive(),
	cost: costSchema,
	thinkingLevelMap: z.record(
		z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
		z.string().nullable(),
	).optional(),
	compat: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])).optional(),
}).strict().refine(model => model.maxTokens <= model.contextWindow, {
	message: "maxTokens cannot exceed contextWindow",
});

let providerSchema = z.object({
	name: z.string().optional(),
	baseUrl: z.string().min(1),
	/** Only an environment reference, so the file holds no secret and Pi never runs a `!command`. */
	apiKey: z.string().regex(
		/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/,
		"apiKey must be an environment reference such as ${AI_GATEWAY_API_KEY}",
	),
	api: API,
	headers: z.record(z.string(), z.string()).optional(),
	models: z.array(modelSchema).min(1),
}).strict();

let fileSchema = z.object({
	providers: z.record(
		z.string().regex(
			/^[a-z][a-z0-9-]{0,31}$/,
			"provider names are lowercase letters, digits, and hyphens",
		),
		providerSchema,
	),
}).strict();

export type PiProviders = Record<string, z.infer<typeof providerSchema>>;

/** Parses and validates one providers file. Throws a sentence naming the problem. */
export function parseProviders(
	source: string,
	options: { path: string; env?: Record<string, string | undefined> },
): PiProviders {
	let env = options.env ?? process.env;
	let raw: unknown;
	try {
		raw = Bun.JSONC.parse(source);
	} catch (cause) {
		throw new Error(`PI_PROVIDERS file ${options.path} is not valid JSON`, { cause });
	}
	let parsed = fileSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`PI_PROVIDERS file ${options.path} is invalid: ${z.prettifyError(parsed.error)}`,
		);
	}
	let providers: PiProviders = {};
	for (let [name, provider] of Object.entries(parsed.data.providers)) {
		let where = `providers.${name}`;
		if (RESERVED.has(name)) {
			throw new Error(`${where} would replace the built-in ${name} provider; choose another name`);
		}
		let key = provider.apiKey.slice(2, -1);
		if (!env[key]) throw new Error(`${where}.apiKey references ${key}, which is not set`);
		let ids = new Set<string>();
		for (let model of provider.models) {
			if (ids.has(model.id)) throw new Error(`${where} lists model ${model.id} more than once`);
			ids.add(model.id);
		}
		providers[name] = {
			...provider,
			baseUrl: substitute(provider.baseUrl, env, `${where}.baseUrl`),
			headers: provider.headers && Object.fromEntries(
				Object.entries(provider.headers).map(([header, value]) => [
					header,
					substitute(value, env, `${where}.headers.${header}`),
				]),
			),
		};
	}
	return providers;
}

let loaded: PiProviders | null | undefined;

/** The process configuration, loaded on first use; `undefined` without `PI_PROVIDERS`. */
export function piProviders(): PiHarnessSettings["providers"] {
	if (loaded !== undefined) return (loaded ?? undefined) as PiHarnessSettings["providers"];
	let path = process.env.PI_PROVIDERS;
	if (!path) {
		loaded = null;
		return undefined;
	}
	let absolute = resolve(path);
	let source: string;
	try {
		source = readFileSync(absolute, "utf8");
	} catch (cause) {
		throw new Error(`PI_PROVIDERS file ${absolute} cannot be read`, { cause });
	}
	loaded = parseProviders(source, { path: absolute });
	console.log(
		`[pi-providers] ${absolute}: ${
			Object.entries(loaded).map(([name, provider]) =>
				`${name} (${provider.models.map(model => model.id).join(", ")})`
			).join("; ")
		}`,
	);
	return loaded as PiHarnessSettings["providers"];
}

/** For tests: forget the loaded configuration. */
export function resetPiProviders(): void {
	loaded = undefined;
}
