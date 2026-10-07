import { INITIAL_JAVASCRIPT_BUDGET } from "./bundle-budget";

import type { JavaScriptBudget } from "./bundle-budget";

// MANTL's initial JavaScript (theme boot and toggle, authorship seams) on top of upstream's budget,
// which upstream keeps within a few hundred bytes of its own bundle. Deriving from upstream's
// constant keeps its later increases without editing its file.
export const MANTL_INITIAL_JAVASCRIPT_BUDGET: JavaScriptBudget = {
	gzip: INITIAL_JAVASCRIPT_BUDGET.gzip + 512,
	raw: INITIAL_JAVASCRIPT_BUDGET.raw + 2_048,
};
