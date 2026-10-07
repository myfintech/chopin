import { describe, expect, it } from "bun:test";

import { words } from "./words";

describe("authorship word changes", () => {
	it("marks only the words that changed", () => {
		expect(words("Retry failed jobs three times.\n", "Retry failed requests five times.\n"))
			.toEqual([
				{ kind: "same", text: "Retry failed " },
				{ kind: "removed", text: "jobs" },
				{ kind: "added", text: "requests" },
				{ kind: "same", text: " " },
				{ kind: "removed", text: "three" },
				{ kind: "added", text: "five" },
				{ kind: "same", text: " times." },
			]);
	});

	it("reads an unchanged block as unchanged", () => {
		expect(words("Same.\n", "Same.")).toEqual([{ kind: "same", text: "Same." }]);
	});
});
