import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { parseProviders } from ".";

let env = { AI_GATEWAY_BASE_URL: "https://gateway.example.test", AI_GATEWAY_API_KEY: "secret" };

function file(provider: Record<string, unknown>, name = "gateway"): string {
	return JSON.stringify({
		providers: {
			[name]: {
				baseUrl: "${AI_GATEWAY_BASE_URL}",
				apiKey: "${AI_GATEWAY_API_KEY}",
				api: "anthropic-messages",
				models: [{
					id: "claude-opus-5-5",
					name: "Claude Opus 5.5",
					reasoning: true,
					input: ["text", "image"],
					contextWindow: 1_000_000,
					maxTokens: 128_000,
					cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
				}],
				...provider,
			},
		},
	});
}

describe("parseProviders", () => {
	it("accepts the shipped MANTL gateway configuration", async () => {
		let path = join(import.meta.dir, "../../config/pi-providers.mantl.jsonc");
		let providers = parseProviders(await Bun.file(path).text(), { path, env });
		expect(providers.mantl!.baseUrl).toBe("https://gateway.example.test");
		expect(providers.mantl!.models.map(model => model.id)).toEqual([
			"claude-opus-5-5",
			"claude-sonnet-5-5",
			"gemini-3.8-flash",
			"gemini-3.5-flash-lite",
			"glm-5.2",
		]);
	});

	it("substitutes the base URL and passes the key through as an environment reference", () => {
		let providers = parseProviders(file({}), { path: "/p.json", env });
		expect(providers.gateway!.baseUrl).toBe("https://gateway.example.test");
		expect(providers.gateway!.apiKey).toBe("${AI_GATEWAY_API_KEY}");
	});

	it("refuses a literal or command API key", () => {
		for (let apiKey of ["sk-literal", "!cat ~/.secret", "$AI_GATEWAY_API_KEY"]) {
			expect(() => parseProviders(file({ apiKey }), { path: "/p.json", env })).toThrow(
				"environment reference",
			);
		}
	});

	it("refuses an unset key or base URL variable", () => {
		expect(() => parseProviders(file({}), { path: "/p.json", env: { AI_GATEWAY_BASE_URL: "x" } }))
			.toThrow("AI_GATEWAY_API_KEY");
		expect(() => parseProviders(file({}), { path: "/p.json", env: { AI_GATEWAY_API_KEY: "k" } }))
			.toThrow("AI_GATEWAY_BASE_URL");
	});

	it("refuses a provider that would replace a harness-registered one", () => {
		expect(() => parseProviders(file({}, "vercel-ai-gateway"), { path: "/p.json", env }))
			.toThrow("built-in vercel-ai-gateway");
	});

	it("refuses inconsistent models", () => {
		let model = JSON.parse(file({})).providers.gateway.models[0];
		expect(() =>
			parseProviders(file({ models: [{ ...model, maxTokens: 2_000_000 }] }), {
				path: "/p.json",
				env,
			})
		).toThrow("maxTokens cannot exceed contextWindow");
		expect(() => parseProviders(file({ models: [model, model] }), { path: "/p.json", env }))
			.toThrow("more than once");
		expect(() =>
			parseProviders(file({ models: [{ ...model, unknown: true }] }), { path: "/p.json", env })
		).toThrow("invalid");
	});
});
