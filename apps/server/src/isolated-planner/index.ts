/**
 * Isolated Atomic Planner. Under `HARNESS=atomic`, upstream runs every Planner
 * session as a full Atomic session whose workflows get shell and filesystem
 * access as the server process's user. With `ATOMIC_PLANNER=isolated`, a Planner
 * session instead runs like Atomic's summary and research workers: only Chopin's
 * host tools, no host resources, and the per-turn tool boundary. Unset or `full`
 * keeps upstream's behavior. See docs/isolated-planner.md.
 */

export type AtomicPlannerMode = "full" | "isolated";

export function atomicPlannerMode(
	env: Record<string, string | undefined> = process.env,
): AtomicPlannerMode {
	let value = env.ATOMIC_PLANNER;
	if (!value || value === "full") return "full";
	if (value === "isolated") return "isolated";
	throw new Error(`ATOMIC_PLANNER must be full or isolated, not ${value}`);
}

/** Whether an Atomic Planner session (never a background job) runs as a full Atomic session. */
export function fullAtomicPlanner(): boolean {
	return atomicPlannerMode() === "full";
}

/** Checks the setting when the Atomic harness starts, so a bad value refuses startup. */
export function announceAtomicPlanner(): void {
	if (atomicPlannerMode() === "full") return;
	console.log(
		"[isolated-planner] ATOMIC_PLANNER=isolated: Planner sessions run isolated, with only "
			+ "Chopin's tools: no shell, host filesystem, workflows, or Atomic web access",
	);
}
