/** Browser coverage for the light, dark and system colour theme. */

import { expect, test } from "./room";

import type { Locator, Page } from "@playwright/test";

function box(target: Locator) {
	return target.evaluate(element => element.getBoundingClientRect().toJSON() as DOMRect);
}

function toggle(page: Page) {
	return page.locator("[data-theme-toggle]");
}

function theme(page: Page) {
	return page.evaluate(() => document.documentElement.dataset.theme);
}

test("the theme toggle sits at the sidebar's trailing edge, centred on the title", async ({ join }) => {
	let page = await join(`theme-${crypto.randomUUID()}`);
	let sidebar = page.getByRole("complementary", { name: "Projects" });
	let title = sidebar.locator("header").getByText("Chopin", { exact: true });
	let control = toggle(page);
	await expect(control).toBeVisible();

	let [rail, label, button] = await Promise.all([box(sidebar), box(title), box(control)]);
	expect(Math.abs(button.y + button.height / 2 - (label.y + label.height / 2))).toBeLessThan(1.5);
	expect(rail.right - button.right).toBeLessThan(20);
	expect(button.left).toBeGreaterThan(rail.left + rail.width / 2);
});

test("the theme defaults to system and follows the operating system", async ({ join }) => {
	let page = await join(`theme-${crypto.randomUUID()}`, { colorScheme: "dark" });
	await expect(toggle(page)).toHaveAttribute("data-theme-toggle", "system");
	expect(await theme(page)).toBe("dark");
	await page.emulateMedia({ colorScheme: "light" });
	await expect.poll(() => theme(page)).toBe("light");
});

test("the toggle cycles light, dark and system and is restored on a new sign-in", async ({ join }) => {
	let handle = `theme-${crypto.randomUUID()}`;
	let page = await join(handle, { colorScheme: "light" });
	let control = toggle(page);
	let background = () =>
		page.evaluate(() =>
			getComputedStyle(document.querySelector("[data-project-sidebar]")!).backgroundColor
		);
	let light = await background();

	let saved = page.waitForResponse(response =>
		response.url().endsWith("/api/preferences") && response.request().method() === "PATCH"
	);
	await control.click();
	await expect(control).toHaveAttribute("data-theme-toggle", "light");
	await saved;

	saved = page.waitForResponse(response =>
		response.url().endsWith("/api/preferences") && response.request().method() === "PATCH"
	);
	await control.click();
	await expect(control).toHaveAttribute("data-theme-toggle", "dark");
	await saved;
	expect(await theme(page)).toBe("dark");
	expect(await background()).not.toBe(light);

	// A fresh browser has no local copy: the choice comes from the server.
	let other = await join(handle, { colorScheme: "light" });
	await expect(toggle(other)).toHaveAttribute("data-theme-toggle", "dark");
	expect(await theme(other)).toBe("dark");

	await control.click();
	await expect(control).toHaveAttribute("data-theme-toggle", "system");
	expect(await theme(page)).toBe("light");
});
