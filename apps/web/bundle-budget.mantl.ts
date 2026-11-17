import { INITIAL_JAVASCRIPT_BUDGET, INITIAL_STYLESHEET_BUDGET } from "./bundle-budget";

import type { JavaScriptBudget, StylesheetBudget } from "./bundle-budget";

// MANTL's initial JavaScript (theme boot and toggle, authorship seams) on top of upstream's budget,
// which upstream keeps within a few hundred bytes of its own bundle. Deriving from upstream's
// constant keeps its later increases without editing its file.
export const MANTL_INITIAL_JAVASCRIPT_BUDGET: JavaScriptBudget = {
	gzip: INITIAL_JAVASCRIPT_BUDGET.gzip + 512,
	raw: INITIAL_JAVASCRIPT_BUDGET.raw + 2_048,
};

// MANTL's initial stylesheet (dark theme and authorship margin) measured about 5,800 B raw and
// 1,300 B gzip above upstream's own at upstream 204e2fad. The allowance stays far below a leaked
// copy of the assistant-ui stylesheet (~93.6 KB raw), which upstream's budget exists to catch.
export const MANTL_INITIAL_STYLESHEET_BUDGET: StylesheetBudget = {
	gzip: INITIAL_STYLESHEET_BUDGET.gzip + 1_536,
	raw: INITIAL_STYLESHEET_BUDGET.raw + 7_168,
};
