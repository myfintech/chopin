import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appliesTo, parseConfig } from "./config";

function directory(): string {
	return mkdtempSync(join(tmpdir(), "planner-extensions-"));
}

describe("parseConfig", () => {
	it("accepts comments, substitutes environment variables, and namespaces tool names", () => {
		let config = parseConfig(
			`{
				// Unblocked is the first stop for context.
				"instructions": "Start with Unblocked.",
				"mcpServers": {
					"unblocked": {
						"transport": {
							"type": "http",
							"url": "https://mcp.example.com/\${REGION}",
							"headers": { "Authorization": "Bearer \${TOKEN}" }
						},
						"tools": ["search", "context.get"],
						"repositories": ["myfintech/*"]
					},
					"jira-cloud": {
						"transport": { "type": "stdio", "command": "mcp-atlassian", "cwd": "work" },
						"tools": ["jira_get_issue"]
					}
				}
			}`,
			{ path: "/etc/chopin/agent.jsonc", env: { REGION: "us", TOKEN: "secret" } },
		);
		expect(config.instructions).toBe("Start with Unblocked.");
		let [unblocked, jira] = config.servers;
		expect(unblocked!.transport).toEqual({
			type: "http",
			url: "https://mcp.example.com/us",
			headers: { Authorization: "Bearer secret" },
		});
		expect(unblocked!.tools).toEqual([
			{ name: "unblocked__search", remote: "search" },
			{ name: "unblocked__context_get", remote: "context.get" },
		]);
		expect(jira!.tools[0]!.name).toBe("jira_cloud__jira_get_issue");
		expect(jira!.transport).toMatchObject({ cwd: "/etc/chopin/work" });
	});

	it("refuses a missing environment variable rather than sending the placeholder", () => {
		expect(() =>
			parseConfig(
				`{"mcpServers":{"a":{"transport":{"type":"http","url":"https://x.test","headers":{"A":"\${NOPE}"}},"tools":["t"]}}}`,
				{ path: "/c.json", env: {} },
			)
		).toThrow("NOPE");
	});

	it("refuses unknown fields, an empty allowlist, and a collision with a built-in tool", () => {
		let base = `"transport":{"type":"http","url":"https://x.test"}`;
		expect(() => parseConfig(`{"extra":1}`, { path: "/c.json" })).toThrow("invalid");
		expect(() => parseConfig(`{"mcpServers":{"a":{${base},"tools":[]}}}`, { path: "/c.json" }))
			.toThrow("invalid");
		expect(() =>
			parseConfig(`{"mcpServers":{"a":{${base},"tools":["t"]}}}`, {
				path: "/c.json",
				reserved: ["a__t"],
			})
		).toThrow("already in use");
	});

	it("loads skills with frontmatter and supporting files relative to the config file", () => {
		let root = directory();
		let skill = join(root, "skills", "briefs");
		mkdirSync(join(skill, "reference"), { recursive: true });
		writeFileSync(
			join(skill, "SKILL.md"),
			"---\nname: project-briefs\ndescription: Find the project brief in Notion.\n---\n\nSearch Notion first.\n",
		);
		writeFileSync(join(skill, "reference", "fields.md"), "Owner, goal, scope.");
		let config = parseConfig(`{"skills":["skills/briefs"]}`, {
			path: join(root, "agent.json"),
			reserved: [],
		});
		expect(config.skills).toHaveLength(1);
		expect(config.skills[0]).toMatchObject({
			name: "project-briefs",
			description: "Find the project brief in Notion.",
			body: "Search Notion first.",
		});
		expect(config.skills[0]!.files.get("reference/fields.md")).toBe("Owner, goal, scope.");
	});

	it("refuses a skill without frontmatter", () => {
		let root = directory();
		mkdirSync(join(root, "bad"));
		writeFileSync(join(root, "bad", "SKILL.md"), "No metadata.");
		expect(() => parseConfig(`{"skills":["bad"]}`, { path: join(root, "agent.json") })).toThrow(
			"frontmatter",
		);
	});
});

describe("appliesTo", () => {
	it("matches all repositories without a list, and owner or exact patterns case-insensitively", () => {
		expect(appliesTo({}, "myfintech/chopin")).toBe(true);
		expect(appliesTo({ repositories: ["MyFintech/*"] }, "myfintech/chopin")).toBe(true);
		expect(appliesTo({ repositories: ["myfintech/chopin"] }, "myfintech/other")).toBe(false);
		expect(appliesTo({ repositories: ["*"] }, "anyone/anything")).toBe(true);
	});
});
