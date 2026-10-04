/**
 * Redelivers host tool results that Pi drops.
 *
 * `@ai-sdk/harness-pi` accepts a host tool result only after Pi starts that
 * tool's `execute`. When the model calls several tools in one step, a result
 * that is ready immediately (for example `read_plan`, which reads memory) can
 * reach `submitToolResult` before Pi has started waiting for it. Pi then files
 * it as a "dangling" result, which only a resumed session uses, and the turn
 * waits forever for a result it already received.
 *
 * Pi acknowledges an accepted result by emitting `tool-result` for that call,
 * and a submission with nothing waiting changes no state. This wrapper therefore
 * resubmits each result until Pi acknowledges it, the turn ends, or a deadline
 * passes. Whichever submission Pi accepts, the result is delivered once.
 */

import type {
	HarnessV1,
	HarnessV1PromptControl,
	HarnessV1PromptTurnOptions,
	HarnessV1Session,
	HarnessV1StreamPart,
} from "@ai-sdk/harness";

/** Retry delays in milliseconds; the last repeats until the deadline. */
const DELAYS = [5, 10, 25, 50, 100, 250];
const DEADLINE_MS = 30_000;

type Turn = Pick<HarnessV1PromptTurnOptions, "emit">;
type ToolResult = Parameters<HarnessV1PromptControl["submitToolResult"]>[0];

async function redeliver<T extends Turn>(
	start: (turn: T) => PromiseLike<HarnessV1PromptControl>,
	turn: T,
): Promise<HarnessV1PromptControl> {
	let acknowledged = new Set<string>();
	let timers = new Set<ReturnType<typeof setTimeout>>();
	let finished = false;
	let control = await start({
		...turn,
		emit: (part: HarnessV1StreamPart) => {
			if (part.type === "tool-result") acknowledged.add(part.toolCallId);
			turn.emit(part);
		},
	});
	let stop = () => {
		finished = true;
		for (let timer of timers) clearTimeout(timer);
		timers.clear();
	};
	let done = Promise.resolve(control.done).finally(stop);
	return {
		async submitToolResult(result: ToolResult) {
			await control.submitToolResult(result);
			let deadline = Date.now() + DEADLINE_MS;
			let attempt = 0;
			let schedule = () => {
				let timer = setTimeout(() => {
					timers.delete(timer);
					if (finished || acknowledged.has(result.toolCallId) || Date.now() > deadline) return;
					attempt++;
					void Promise.resolve(control.submitToolResult(result)).catch(() => {}).finally(schedule);
				}, DELAYS[Math.min(attempt, DELAYS.length - 1)]);
				timers.add(timer);
			};
			if (!acknowledged.has(result.toolCallId)) schedule();
		},
		submitToolApproval: input => control.submitToolApproval?.(input) ?? Promise.resolve(),
		submitUserMessage: text => control.submitUserMessage?.(text) ?? Promise.resolve(),
		done,
	};
}

export function redeliverToolResults<H extends HarnessV1>(harness: H): H {
	return {
		...harness,
		async doStart(options) {
			let session: HarnessV1Session = await harness.doStart(options);
			return {
				...session,
				doPromptTurn: turn => redeliver(next => session.doPromptTurn(next), turn),
				doContinueTurn: turn => redeliver(next => session.doContinueTurn(next), turn),
			};
		},
	};
}
