import { expect, it } from "bun:test";

import { redeliverToolResults } from ".";

import type { HarnessV1, HarnessV1PromptTurnOptions, HarnessV1StreamPart } from "@ai-sdk/harness";

/** Mimics Pi: a result submitted before `execute` registers it is silently dropped. */
function fakePi(waitMs: number) {
	let submissions: string[] = [];
	let finish: (() => void) | undefined;
	let harness = {
		specificationVersion: "harness-v1",
		harnessId: "fake-pi",
		builtinTools: {},
		async doStart(options: { sessionId: string }) {
			return {
				sessionId: options.sessionId,
				isResume: false,
				async doPromptTurn(turn: HarnessV1PromptTurnOptions) {
					let pending = new Set<string>();
					let done = Promise.withResolvers<void>();
					finish = done.resolve;
					turn.emit({ type: "tool-call", toolCallId: "fast", toolName: "read_plan", input: "{}" });
					setTimeout(() => pending.add("fast"), waitMs);
					return {
						async submitToolResult(result: { toolCallId: string; output: unknown }) {
							submissions.push(result.toolCallId);
							if (!pending.delete(result.toolCallId)) return;
							turn.emit({
								type: "tool-result",
								toolCallId: result.toolCallId,
								toolName: "read_plan",
								result: result.output as string,
							});
						},
						done: done.promise,
					};
				},
			};
		},
	} as unknown as HarnessV1;
	return { harness, submissions, finish: () => finish?.() };
}

async function turn(harness: HarnessV1, parts: HarnessV1StreamPart[]) {
	let session = await harness.doStart({ sessionId: "s" } as never);
	return session.doPromptTurn(
		{ tools: [], emit: (part: HarnessV1StreamPart) => parts.push(part) } as never,
	);
}

it("resubmits a result Pi dropped until Pi acknowledges it, then stops", async () => {
	let pi = fakePi(30);
	let parts: HarnessV1StreamPart[] = [];
	let control = await turn(redeliverToolResults(pi.harness), parts);
	await control.submitToolResult({ toolCallId: "fast", output: "plan" });
	await Bun.sleep(200);
	expect(parts.filter(part => part.type === "tool-result")).toHaveLength(1);
	let count = pi.submissions.length;
	expect(count).toBeGreaterThan(1);
	await Bun.sleep(300);
	expect(pi.submissions.length).toBe(count);
	pi.finish();
});

it("submits once when Pi is already waiting", async () => {
	let pi = fakePi(0);
	let parts: HarnessV1StreamPart[] = [];
	let control = await turn(redeliverToolResults(pi.harness), parts);
	await Bun.sleep(5);
	await control.submitToolResult({ toolCallId: "fast", output: "plan" });
	await Bun.sleep(100);
	expect(pi.submissions).toEqual(["fast"]);
	expect(parts.filter(part => part.type === "tool-result")).toHaveLength(1);
	pi.finish();
});

it("stops resubmitting when the turn ends", async () => {
	let pi = fakePi(10_000);
	let control = await turn(redeliverToolResults(pi.harness), []);
	await control.submitToolResult({ toolCallId: "fast", output: "plan" });
	await Bun.sleep(50);
	pi.finish();
	await control.done;
	let count = pi.submissions.length;
	await Bun.sleep(300);
	expect(pi.submissions.length).toBe(count);
});

it("without redelivery, the dropped result is never acknowledged", async () => {
	let pi = fakePi(30);
	let parts: HarnessV1StreamPart[] = [];
	let control = await turn(pi.harness, parts);
	await control.submitToolResult({ toolCallId: "fast", output: "plan" });
	await Bun.sleep(200);
	expect(parts.filter(part => part.type === "tool-result")).toHaveLength(0);
	pi.finish();
});
