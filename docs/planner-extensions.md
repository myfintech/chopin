# Planner extensions

> MANTL-owned feature. See [MANTL.md](../MANTL.md). Upstream behavior is unchanged when
> `PLANNER_EXTENSIONS` is unset.

Planner extensions let an operator give the hosted Planner extra read-only context
tools without code changes: MCP servers (for example Jira, Notion, or Unblocked),
skills, and instructions about when to use them.

## Configure

Set `PLANNER_EXTENSIONS` to the path of a JSON file (comments allowed). The server
reads it once at startup and refuses to start if it is invalid.

```jsonc
{
	// Appended after the built-in prompt, and takes precedence over its default tool guidance.
	"instructions": "Always start with Unblocked to search for plan context. Use Unblocked for code search and retrieval before falling back to search_repository and read_repository_file.",
	"mcpServers": {
		"unblocked": {
			"transport": {
				"type": "http",
				"url": "https://unblocked.example.com/mcp",
				"headers": { "Authorization": "Bearer ${UNBLOCKED_TOKEN}" },
			},
			"tools": ["search", "ask"],
			"instructions": "Broad organizational and codebase context.",
		},
		"jira": {
			"transport": {
				"type": "stdio",
				"command": "uvx",
				"args": ["mcp-atlassian"],
				"env": {
					"JIRA_URL": "https://example.atlassian.net",
					"JIRA_USERNAME": "${JIRA_USERNAME}",
					"JIRA_API_TOKEN": "${JIRA_API_TOKEN}",
					"READ_ONLY_MODE": "true",
				},
			},
			"tools": ["jira_get_issue", "jira_search"],
			"instructions": "Look up a ticket when a participant mentions a Jira key such as ABC-123.",
			"repositories": ["myfintech/*"],
		},
		"notion": {
			"transport": {
				"type": "stdio",
				"command": "npx",
				"args": ["-y", "@notionhq/notion-mcp-server"],
				"env": { "NOTION_TOKEN": "${NOTION_TOKEN}" },
			},
			"tools": ["API-post-search", "API-retrieve-a-page", "API-get-block-children"],
			"instructions": "Find project briefs.",
		},
	},
	"skills": ["./skills/project-briefs"],
}
```

Tool names, package names, and environment variables above are illustrative. Check
each MCP server's documentation, and the server log, for the exact tool names it
offers.

### `mcpServers`

| Field           | Required | Meaning                                                                                                                                                                                         |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport`     | yes      | `{ "type": "http" \| "sse", "url", "headers"? }` or `{ "type": "stdio", "command", "args"?, "env"?, "cwd"? }`.                                                                                  |
| `tools`         | yes      | Allowlist of remote tool names. Every other tool the server offers is dropped.                                                                                                                  |
| `instructions`  | no       | One line shown to the Planner next to this server's tools.                                                                                                                                      |
| `repositories`  | no       | `owner/name`, `owner/*`, or `*` patterns. Without it, the server applies to every repository. Other repositories never connect and see the tools as disabled.                                   |
| `timeoutMs`     | no       | Connection and tool-list timeout, 1,000 to 120,000. Default 15,000.                                                                                                                             |
| `callTimeoutMs` | no       | Bound on one tool call, 5,000 to 900,000. Default 180,000. A call that runs longer returns an error to the Planner and reconnects the server, so a stalled remote call cannot hold a turn open. |

Server names are lowercase letters, digits, and hyphens. The Planner sees each tool
as `<server>__<tool>`, with hyphens in the server name and dots in the tool name
replaced by underscores, for example `unblocked__search`. A name that collides with a
built-in Planner tool, or exceeds 64 characters, fails startup.

`${NAME}` in a transport's `url`, `headers`, `command`, `args`, `env`, or `cwd` is
replaced with the environment variable. A missing variable fails startup, so a
placeholder is never sent as a credential. Keep secrets in the environment, not in
the file.

A stdio server inherits only a minimal default environment (such as `PATH` and
`HOME`), not the Chopin server's secrets. Pass what it needs through `env`. Its
command must exist where the server runs. Relative `cwd` and skill paths resolve
against the configuration file's directory.

The Docker image includes `bunx`, Node.js 24 with `npm` and `npx`, and `uv`/`uvx`
with the Debian `python3`. `npx -y <package>` and `uvx <package>` download the
server package on first use into the `bun` user's home directory (`~/.npm`,
`~/.cache/uv`), which is not persisted, so a new container downloads it again.
That typically takes a few seconds; raise `timeoutMs` if a large package or slow
network exceeds the 15 second default. Pin package versions (for example
`@notionhq/notion-mcp-server@1.9.0`) so a container restart cannot pick up a
different server release.

### `skills`

Each entry is a directory with a `SKILL.md` that starts with YAML frontmatter:

```markdown
---
name: project-briefs
description: Find and summarize a project's brief before drafting a plan.
---

Search Notion for the project name first, then...
```

The Planner's prompt lists each skill's name and description. A `read_skill` tool
loads the body, or a supporting file in the same directory (at most 50 files of
256 KiB each, symlinks ignored). Skills are loaded at startup and work under both
harnesses; they are not passed to a harness's native skill mechanism.

### `instructions`

Text appended after the built-in Planner prompt, after the configured tool and skill
lists. Use it to set tool priority, for example to prefer an MCP code search over
the built-in repository tools.

## Runtime behavior

- Clients are process-wide and open lazily on the first Planner session. An
  unavailable server is logged and skipped; the session still opens, and the
  affected tools return an error to the model. A failed connection is retried after
  30 seconds. A thrown call error drops the connection and the next call reconnects.
- The log reports each connection's allowlisted tools and names any allowlisted tool
  the server does not offer, along with what it does offer.
- Before every call, the tool rechecks the Planner owner's admission, session,
  generation, credential, and repository access, like the built-in tools.
- Each call is bounded by `callTimeoutMs` and also ends when the turn is aborted.
- Results are flattened to text and truncated at 60,000 characters. Non-text content
  is omitted.
- Extensions apply to Planner turns only, not research or summary workers.
- `AGENT=off` never opens a connection.

## Security model

Read [Authentication and authorization](authentication.md) and the
[hosted agent](hosted-agent.md) boundary first. Extensions widen that boundary on
purpose:

- **Operator credentials are shared.** Every configured server uses one set of
  credentials. Any admitted user with push or administration access to a repository
  the server applies to can, by invoking the Planner, read anything those credentials
  reach. Scope the credentials (and `repositories`) to what every such user may see.
- **Tools must be read-only.** This is a documented rule, not something Chopin can
  verify. Allowlist only read tools, and use server-side read-only modes and
  read-only tokens where they exist.
- **Output is untrusted.** Tool results can contain prompt injection. The Planner
  can edit the shared document, so the prompt tells it not to follow instructions
  in tool output, but that is not a guarantee.
- **The Copilot host-only check still applies.** MCP clients run in the Chopin
  server process and are exposed to the harness as ordinary host tools, so the
  Copilot SDK adapter still sees no MCP server of its own.

## Not supported yet

- Per-user credentials or OAuth for a configured server.
- Pi extensions (`HARNESS=pi` extension factories).
- Per-tool description overrides, and extensions for background workers.

## Implementation

- Configuration and skill loading: `apps/server/src/planner-extensions/config.ts`
- MCP connections and bound tools: `apps/server/src/planner-extensions/mcp.ts`
- Placeholders, session tools, prompt text, and shutdown:
  `apps/server/src/planner-extensions/index.ts`
- Seams in upstream files are listed in [MANTL.md](../MANTL.md#upstream-divergences).
