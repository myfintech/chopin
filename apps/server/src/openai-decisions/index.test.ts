import { afterEach, describe, expect, it } from "bun:test";

import { askDecisions, decisionsQuestion } from ".";
import { askJev } from "../conversation-plan/jev";
import { configured } from "../config-conversation.test-fixtures";

import type { JevQuestion } from "../conversation-plan/jev";

let env = { OPENAI_DECISIONS_API_KEY: "sk-test" };

let questions: Record<string, JevQuestion> = {
	initiative: {
		type: "choice",
		instructions: "Whose turn is it?",
		criteria: { direct: "Asked Chopin", respond: "Chopin's turn", yield: "Humans talking" },
	},
	invited: {
		type: "noul",
		instructions: "Was Chopin invited?",
		criteria: { true: "Yes", false: "No" },
	},
	urgency: { type: "score", instructions: "How urgent?", criteria: ["low", "medium", "high"] },
};

let answers = [
	{
		type: "choice",
		name: "initiative",
		choice: "direct",
		confidence: 0.9,
		probabilities: [
			{ value: "direct", probability: 0.8 },
			{ value: "respond", probability: 0.15 },
			{ value: "yield", probability: 0.05 },
		],
	},
	{ type: "predicate", name: "invited", probability: 0.92 },
	{
		type: "score",
		name: "urgency",
		score: 1.1,
		confidence: 0.55,
		probabilities: [
			{ value: 0, label: "0", probability: 0.2 },
			{ value: 1, label: "1", probability: 0.5 },
			{ value: 2, label: "2", probability: 0.3 },
		],
	},
];

function respond(body: unknown, status = 200) {
	let seen: { url?: string; init?: RequestInit } = {};
	let fetch = async (url: string, init?: RequestInit) => {
		seen.url = url;
		seen.init = init;
		return new Response(JSON.stringify(body), { status });
	};
	return { fetch, seen };
}

describe("decisionsQuestion", () => {
	it("maps Jev's question types to Decisions' predicate, choice and score", () => {
		expect(decisionsQuestion("initiative", questions.initiative!)).toEqual({
			type: "choice",
			name: "initiative",
			instructions: "Whose turn is it?",
			choices: [
				{ value: "direct", description: "Asked Chopin" },
				{ value: "respond", description: "Chopin's turn" },
				{ value: "yield", description: "Humans talking" },
			],
		});
		expect(decisionsQuestion("invited", questions.invited!)).toEqual({
			type: "predicate",
			name: "invited",
			instructions: "Was Chopin invited?\nTrue: Yes\nFalse: No",
		});
		expect(decisionsQuestion("urgency", questions.urgency!)).toEqual({
			type: "score",
			name: "urgency",
			instructions: "How urgent?",
			levels: [
				{ label: "0", description: "low" },
				{ label: "1", description: "medium" },
				{ label: "2", description: "high" },
			],
		});
	});
});

describe("askDecisions", () => {
	it("posts to the Decisions endpoint and answers in Jev's shape", async () => {
		let { fetch, seen } = respond({ answers });
		let result = await askDecisions(
			{ state: { sourceId: "m1" }, questions },
			{ fetch, model: "jev-1.13.0" },
			{ ...env, OPENAI_DECISIONS_BASE_URL: "https://gateway.example.test/v1/" },
		);
		expect(seen.url).toBe("https://gateway.example.test/v1/decisions");
		expect((seen.init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
		let body = JSON.parse(String(seen.init?.body));
		expect(body.model).toBe("gpt-6-luna");
		expect(body.input).toBe(JSON.stringify({ sourceId: "m1" }));
		expect(body.questions.map((question: { name: string }) => question.name)).toEqual([
			"initiative",
			"invited",
			"urgency",
		]);
		expect(result.model).toBe("gpt-6-luna");
		expect(result.answers).toEqual({
			initiative: {
				type: "choice",
				choice: "direct",
				confidence: 0.9,
				probabilities: { direct: 0.8, respond: 0.15, yield: 0.05 },
			},
			invited: { type: "noul", noul: 0.92 },
			urgency: {
				type: "score",
				score: 1.1,
				confidence: 0.55,
				legend: { "0": "low", "1": "medium", "2": "high" },
				probabilities: { "0": 0.2, "1": 0.5, "2": 0.3 },
			},
		});
	});

	it("refuses a refusal, a missing answer, and a choice that is not the most likely", async () => {
		let cases = [
			{ answers: [{ type: "refusal", name: "initiative" }, ...answers.slice(1)] },
			{ answers: answers.slice(1) },
			{ answers: [{ ...answers[0], choice: "yield" }, ...answers.slice(1)] },
		];
		for (let body of cases) {
			await expect(askDecisions({ state: {}, questions }, respond(body), env)).rejects.toThrow();
		}
	});

	it("reports an HTTP failure without its body", async () => {
		await expect(
			askDecisions({ state: {}, questions }, respond({ error: "secret detail" }, 429), env),
		).rejects.toThrow("Decisions HTTP 429");
	});
});

describe("askJev with OPENAI_DECISIONS_API_KEY", () => {
	let previous = process.env.OPENAI_DECISIONS_API_KEY;
	afterEach(() => {
		if (previous === undefined) delete process.env.OPENAI_DECISIONS_API_KEY;
		else process.env.OPENAI_DECISIONS_API_KEY = previous;
	});

	it("goes to Decisions instead of TypeSafe", async () => {
		process.env.OPENAI_DECISIONS_API_KEY = "sk-test";
		let { fetch, seen } = respond({ answers: answers.slice(0, 1) });
		let result = await askJev({ state: {}, questions: { initiative: questions.initiative! } }, {
			fetch,
		});
		expect(seen.url).toBe("https://api.openai.com/v1/decisions");
		expect(result.answers.initiative).toMatchObject({ type: "choice", choice: "direct" });
	});
});

describe("startup", () => {
	it("accepts an OpenAI Decisions key in place of JEV_API_KEY", () => {
		let settings = { JEV_API_KEY: undefined, OPENAI_DECISIONS_API_KEY: "sk-test" };
		expect(configured(settings).agent).toBe(true);
		expect(configured({ ...settings, CONVERSATION_PLAN: "on" }).conversationPlan).toBe(true);
		expect(() => configured({ ...settings, OPENAI_DECISIONS_API_KEY: undefined }))
			.toThrow("JEV_API_KEY is required when AGENT is enabled");
	});
});
