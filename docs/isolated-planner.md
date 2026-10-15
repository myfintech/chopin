# Isolated Atomic Planner

> MANTL-owned feature. See [MANTL.md](../MANTL.md). Upstream behavior is unchanged when
> `ATOMIC_PLANNER` is unset.

Under `HARNESS=atomic`, upstream runs every Planner session as a
[full Atomic session](hosted-agent.md#full-atomic-planner). The workflows it starts get shell and
filesystem access as the server process's user, and its own turns can read any path the server can.
Upstream has no switch for this. Its advice is to use `copilot-sdk` instead, which the MANTL
gateway cannot serve.

`ATOMIC_PLANNER=isolated` runs Planner sessions the way Atomic's summary and research workers
already run. A session sees only Chopin's host tools (document, Decisions, child document,
repository and job tools) and the operator's [Planner extensions](planner-extensions.md). It loads
no Atomic builtins, extensions, skills, prompt templates or context files. The adapter's per-turn
tool boundary refuses anything else. This is the same tool boundary the Pi harness gave production
before upstream removed it.

| `ATOMIC_PLANNER` | Planner session                                  |
| ---------------- | ------------------------------------------------ |
| unset or `full`  | Upstream's full Atomic session                   |
| `isolated`       | Isolated, like the background workers            |
| anything else    | Startup is refused when the Atomic harness loads |

The setting applies only under `HARNESS=atomic`. Background jobs are isolated either way.

## What isolation gives up

Nothing the Pi Planner had. Compared with a full Atomic session, an isolated Planner has no:

- **Workflows.** No `workflow` tool, so no run cards in Chat, no workflow questions under
  Decisions, and no retained session while runs are live. **Stop Planner** stops the turn as it
  always has; **Resume Planner** only appears for paused runs, so it never shows.
- **Atomic web research** (`web_search`, `fetch_content`, `get_search_content`, `code_search`).
  These send queries to Exa, Jina Reader and DeepWiki without configuration.
- **Working-directory tools** (`read`, `find`, `search`, `ast_grep`). On the deployed server
  they would only see an empty per-document directory, since a checkout is only used when
  `invoke_planner` names a path on the server itself, and `read` is not confined to it.
- **`ask_user_question`, `intercom` and `codemode`.** Chopin's own `ask` tool already creates
  Decisions, and no other Atomic session runs on the server for `intercom` to reach.
- **Operator Atomic resources and `HARNESS_EXTENSIONS`.**

Upstream ships no workflows of its own and starts none from code. The run cards, Stop and
Resume, and Decisions plumbing exist so the model can choose to call Atomic's `workflow` tool.
No Chopin feature depends on a workflow.

The Planner prompt is upstream's isolated variant ("You have no shell, checkout, host
filesystem..."). `invoke_planner` still verifies a checkout it names, as upstream does under
`HARNESS=atomic`, but an isolated session never uses it.

## Running workflows securely later

Workflow stages must run outside the Chopin server process, on a machine that holds none of its
secrets. Any shell running as the server's user can read the process's environment and reach its
database, so a container or a restricted profile around the same process is not enough.

- **Upstream today:** `HARNESS=remote` runs the model, Atomic and its workflows in a client
  attached over the [agent connection](agent-connection.md), such as a paired "Server or VM"
  machine; the server gains no shell. It does not suit the deployed instance yet: it applies to
  every document (an `@chopin` request without an attached client fails with
  `planner-not-attached`), it requires `BACKGROUND_JOBS=off`, a shared machine acts as the
  account that paired it, and upstream ships no Atomic Planner backend command for
  `--planner-command`.
- **Watch upstream:** per-document machine choice suggests a hybrid of hosted Planners by
  default and machine Planners per document. If it lands, a dedicated Planner VM, or each
  member's own machine, becomes configuration rather than a project.
- **Build our own:** a runner that executes each workflow in a disposable sandbox with no
  secrets and network access only to the gateway. It is the strongest isolation and the most
  MANTL-owned code, so start it only if workflows prove valuable.

## Implementation

- Mode and startup check: `apps/server/src/isolated-planner/index.ts`
- Seams: `openPlannerSession` in `apps/server/src/harness/session.ts` opens a full session only
  when `fullAtomicPlanner()`; `createAtomicHarness` in `apps/server/src/harness/harnesses.ts`
  calls `announceAtomicPlanner()`.
- Upstream's startup summary still prints `Planner: full Atomic session`; the
  `[isolated-planner]` log line says when isolation applies instead.
