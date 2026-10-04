// TEMP DEBUG (do not commit): traces the host-tool boundary of a harness.
import type { HarnessV1 } from "@ai-sdk/harness";

let stamp = () => new Date().toISOString().slice(11, 23);
export function traceHarness<T extends HarnessV1>(base: T): T {
	return {
		...base,
		async doStart(options: any) {
			let session = await base.doStart(options);
			let wrap = (run: (turn: any) => PromiseLike<any>) => async (turn: any) => {
				console.log(
					`[trace ${stamp()}] turn start: ${turn.tools.length} tools, model=${turn.model}`,
				);
				let control = await run({
					...turn,
					emit: (part: any) => {
						if (
							/^(tool-call|tool-result|tool-approval-request|finish|finish-step|error)$/.test(
								part.type,
							)
						) {
							console.log(
								`[trace ${stamp()}] pi emits ${part.type} ${part.toolName ?? ""} ${
									part.toolCallId ?? ""
								}${part.isError ? " isError" : ""}${
									part.type === "error" ? " " + String(part.error).slice(0, 200) : ""
								}`,
							);
						}
						turn.emit(part);
					},
				});
				return {
					...control,
					submitToolResult: (result: any) => {
						console.log(
							`[trace ${stamp()}] host submits result ${result.toolCallId}${
								result.isError ? " isError " + JSON.stringify(result.output).slice(0, 160) : " ok"
							}`,
						);
						return control.submitToolResult(result);
					},
				};
			};
			return {
				...session,
				doPromptTurn: wrap(turn => session.doPromptTurn(turn)),
				doContinueTurn: wrap(turn => session.doContinueTurn(turn)),
			};
		},
	} as T;
}
