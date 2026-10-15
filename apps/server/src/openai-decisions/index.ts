/**
 * OpenAI Decisions as the judgment service behind upstream's Jev calls. With
 * `OPENAI_DECISIONS_API_KEY` set, `askJev` sends each request to
 * `POST {OPENAI_DECISIONS_BASE_URL}/decisions` instead of TypeSafe, and the
 * answers come back in Jev's shape through upstream's own validation. Jev's
 * `noul`, `choice` and `score` questions map to Decisions' `predicate`,
 * `choice` and `score`; Jev's model alias is ignored for
 * `OPENAI_DECISIONS_MODEL`. Unset keeps upstream's Jev. See
 * docs/openai-decisions.md.
 */

import { validateJevResponse } from "../conversation-plan/jev";

import type { JevOptions, JevQuestion, JevRequest, JevResult } from "../conversation-plan/jev";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-6-luna";
const MAX_BYTES = 262_144;

type Env = Record<string, string | undefined>;

export function decisionsConfigured(env: Env = process.env): boolean {
	return !!env.OPENAI_DECISIONS_API_KEY;
}

type DecisionsQuestion =
	| { type: "predicate"; name: string; instructions: string }
	| {
		type: "choice";
		name: string;
		instructions: string;
		choices: Array<{ value: string; description: string }>;
	}
	| {
		type: "score";
		name: string;
		instructions: string;
		levels: Array<{ label: string; description: string }>;
	};

/** Jev's question as a Decisions question named by its Jev id. */
export function decisionsQuestion(name: string, question: JevQuestion): DecisionsQuestion {
	if (question.type === "noul") {
		let criteria = question.criteria;
		return {
			type: "predicate",
			name,
			instructions: criteria
				? `${question.instructions}\nTrue: ${criteria.true}\nFalse: ${criteria.false}`
				: question.instructions,
		};
	}
	if (question.type === "choice") {
		return {
			type: "choice",
			name,
			instructions: question.instructions,
			choices: Object.entries(question.criteria).map(([value, description]) => ({
				value,
				description,
			})),
		};
	}
	return {
		type: "score",
		name,
		instructions: question.instructions,
		levels: question.criteria.map((description, index) => ({ label: String(index), description })),
	};
}

function record(value: unknown, what: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`invalid Decisions ${what}`);
	}
	return value as Record<string, unknown>;
}

/** Decisions' `[{ value, probability }]` as Jev's `{ [key]: probability }`. */
function distribution(value: unknown, keys: readonly string[]): Record<string, number> {
	if (!Array.isArray(value)) throw new Error("invalid Decisions probabilities");
	let result: Record<string, unknown> = {};
	for (let item of value) {
		let entry = record(item, "probability");
		result[String(entry.value)] = entry.probability;
	}
	return Object.fromEntries(keys.map(key => [key, result[key]])) as Record<string, number>;
}

/** A Decisions response in the shape upstream's `validateJevResponse` checks. */
export function jevResponse(
	value: unknown,
	questions: Record<string, JevQuestion>,
	model: string,
): unknown {
	let response = record(value, "response");
	if (!Array.isArray(response.answers)) throw new Error("invalid Decisions answers");
	let byName = new Map<string, Record<string, unknown>>();
	for (let item of response.answers) {
		let answer = record(item, "answer");
		if (answer.type === "refusal") throw new Error("Decisions refused a question");
		byName.set(String(answer.name), answer);
	}
	let answers: Record<string, unknown> = {};
	for (let [id, question] of Object.entries(questions)) {
		let answer = byName.get(id);
		if (!answer) throw new Error("invalid Decisions answer keys");
		if (question.type === "noul") {
			if (answer.type !== "predicate") throw new Error("invalid Decisions answer type");
			answers[id] = { type: "noul", noul: answer.probability };
		} else if (question.type === "choice") {
			if (answer.type !== "choice") throw new Error("invalid Decisions answer type");
			answers[id] = {
				type: "choice",
				choice: answer.choice,
				confidence: answer.confidence,
				probabilities: distribution(answer.probabilities, Object.keys(question.criteria)),
			};
		} else {
			if (answer.type !== "score") throw new Error("invalid Decisions answer type");
			let levels = question.criteria.map((_, index) => String(index));
			answers[id] = {
				type: "score",
				score: answer.score,
				confidence: answer.confidence,
				legend: Object.fromEntries(question.criteria.map((label, index) => [String(index), label])),
				probabilities: distribution(answer.probabilities, levels),
			};
		}
	}
	let usage = response.usage && typeof response.usage === "object"
		? response.usage as Record<string, unknown>
		: {};
	return {
		model: typeof response.model === "string" && response.model ? response.model : model,
		answers,
		usage: {
			input_tokens: Number.isSafeInteger(usage.input_tokens) ? usage.input_tokens : 0,
			output_tokens: Number.isSafeInteger(usage.output_tokens) ? usage.output_tokens : 0,
		},
	};
}

/** `askJev` over OpenAI Decisions; `askJev` has already checked the request's bounds. */
export async function askDecisions(
	request: JevRequest,
	options: JevOptions = {},
	env: Env = process.env,
): Promise<JevResult> {
	let apiKey = env.OPENAI_DECISIONS_API_KEY;
	if (!apiKey) throw new Error("OpenAI Decisions API key is not configured");
	let base = (env.OPENAI_DECISIONS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
	let model = env.OPENAI_DECISIONS_MODEL || DEFAULT_MODEL;
	let timeoutMs = options.timeoutMs ?? 30_000;
	let body = JSON.stringify({
		model,
		input: typeof request.state === "string" ? request.state : JSON.stringify(request.state),
		questions: Object.entries(request.questions).map(([name, question]) =>
			decisionsQuestion(name, question)
		),
	});
	if (Buffer.byteLength(body, "utf8") > MAX_BYTES) {
		throw new Error("invalid Decisions request bounds");
	}
	let timeout = AbortSignal.timeout(timeoutMs);
	let signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	let started = performance.now();
	let response: Response;
	try {
		response = await (options.fetch ?? fetch)(`${base}/decisions`, {
			method: "POST",
			redirect: "error",
			signal,
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body,
		});
	} catch {
		throw new Error(
			options.signal?.aborted
				? "Decisions request aborted"
				: timeout.aborted
				? "Decisions request timed out"
				: "Decisions request failed",
		);
	}
	if (!response.ok) throw new Error(`Decisions HTTP ${response.status}`);
	let text = await response.text();
	if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
		throw new Error("Decisions response is too large");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("invalid Decisions JSON");
	}
	let result = validateJevResponse(
		jevResponse(parsed, request.questions, model),
		request.questions,
	);
	result.latencyMs = Math.round(performance.now() - started);
	return result;
}
