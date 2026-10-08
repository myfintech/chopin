# Working on MANTL's Chopin

This repository, [myfintech/chopin](https://github.com/myfintech/chopin), is MANTL's downstream
copy of [githubnext/chopin](https://github.com/githubnext/chopin). We regularly merge upstream
into it. `git diff upstream/main...main` shows everything MANTL has changed.

**Core principle: every change must survive repeated upstream merges.** Keep MANTL's diff
against upstream as small, isolated, and easy to understand as possible. A clever change
that conflicts on every merge costs more than a plain change that never conflicts.

[AGENTS.md](AGENTS.md) is upstream's guide and still applies to architecture, security,
testing, and conventions. This file adds MANTL rules. If the two conflict, follow this file.

## Remotes

| Remote     | Repository          | Role                                    |
| ---------- | ------------------- | --------------------------------------- |
| `origin`   | `myfintech/chopin`  | MANTL's; our branches and pull requests |
| `upstream` | `githubnext/chopin` | Source project; read-only for us        |

Open MANTL pull requests against `origin`. Never push to `upstream`.

## Merge-friendly change rules

1. **Add instead of modifying.** Prefer new files, modules, components, routes, scripts,
   skills, and docs over edits to upstream-owned files. A new file never conflicts.
2. **When an upstream file must change, add a thin seam.** Keep the hunk minimal, for
   example one import plus one call, registration, or option that delegates to MANTL-owned
   code. Put the logic in the MANTL-owned file, not inline.
3. **Do not churn upstream code.** Do not reformat, rename, reorder, move, or re-indent
   upstream code, and do not apply opportunistic lint or style fixes to it. Match upstream
   conventions exactly so `bun run fix` produces no unrelated diffs in upstream files.
4. **Do not refactor upstream code for taste.** Refactor upstream code only when a MANTL
   feature needs it. Keep that refactor in its own commit so it is easy to drop or send
   upstream.
5. **Preserve upstream defaults.** New behavior should be opt-in through configuration,
   environment variables, or feature flags. When the setting is absent, upstream behavior
   should stay unchanged.
6. **Keep the wire and storage compatible.** Add optional protocol fields instead of changing
   existing ones. Never edit an upstream migration. Upstream numbers migrations sequentially,
   and the runner in `apps/server/src/storage/postgres/migrations.ts` rejects unknown or
   changed migrations. A MANTL migration can collide with upstream's next number. Stop and ask
   before adding a schema change.
7. **Minimize dependency changes.** Avoid adding or bumping dependencies in `package.json`.
   After an upstream merge, regenerate `bun.lock` with `bun install` instead of hand-merging it.
8. **Keep MANTL docs separate.** Put MANTL documentation in MANTL-owned files such as this
   one or a new `docs/*.md` named for its feature. Limit `AGENTS.md`, `README.md`, and other
   upstream docs to short pointers to MANTL files.
9. **Make fixes upstream-ready.** If a change is broadly useful, such as a bug fix, write it as
   a standalone commit that could become an upstream pull request. Once upstream merges an
   equivalent change, remove the MANTL version.
10. **Record every divergence.** When you add a MANTL-owned file or edit an upstream file, add
    a row to [Upstream divergences](#upstream-divergences). This is the checklist for each upstream merge.

## Naming and placement

- Never use the word `fork` in a file name, folder name, identifier, or comment label. Name
  code and docs for what they do, for example `apps/server/src/planner-extensions/` and
  `docs/planner-extensions.md`.
- Encapsulate each MANTL feature in its own new folder or file, such as
  `apps/server/src/<feature>/`, so upstream files only hold thin seams that import from it.
- Use a `mantl` prefix or suffix only for files that are truly MANTL-specific, such as this
  file or `apps/server/config/pi-providers.mantl.jsonc`. General features that could go
  upstream get plain semantic names.

## Commits

- Keep each commit to one purpose. Keep mechanical changes separate from behavioral ones.
  Keep upstream-file seams in the same commit as the MANTL code they call.
- Follow upstream's commit message style: an imperative, sentence-case summary with no type
  prefix, for example `Await anchor plan publication before sidecar persistence`.
- Squash fixups before merging. Fewer, coherent commits are easier to review and to send
  upstream.

## Syncing with upstream

`main` only moves forward. Never rebase or force-push it: it deploys on every push, and open
pull requests and every clone build on its history.

[`mantl-upstream-sync.yml`](.github/workflows/mantl-upstream-sync.yml) runs each weekday
morning and on demand. It merges `upstream/main` into the `upstream-sync` branch and opens a
pull request against `main`. If an earlier sync pull request is still open, it merges into that
branch again and comments on the pull request instead of replacing it. `bun.lock` is always
regenerated, never merged. When the merge conflicts, or `bun run ci`, `bun run types`, or
`bun test` fail after it, Claude, running through the MANTL LLM gateway, resolves them under
this file's rules. It commits conflict resolutions in the merge commit and follow-up fixes as
separate commits, then writes a summary into the pull request. When a resolution needs a product, schema, or protocol decision, Claude
stops and the workflow opens an issue titled `Upstream sync needs attention` instead.

To review a sync pull request:

1. Read Claude's summary, then the merge commit's resolutions with `git show --remerge-diff`.
2. Check every renewed design-contract hash against
   [Pinned design exceptions](#pinned-design-exceptions).
3. Check that the [Upstream divergences](#upstream-divergences) table still matches.
4. Wait for CI, then merge with **Create a merge commit**. Squash or rebase drops upstream's
   history, and the next sync then conflicts on everything since.

To sync by hand, for example after a failed run:

```bash
git fetch upstream
git switch -c upstream-sync origin/main
git merge upstream/main
bun install            # regenerate bun.lock; never hand-merge it
bun run types
bun test
bun run ci
```

Then open a pull request and merge it with a merge commit. Agents must not push to `main` or
merge pull requests unless the user explicitly asks.

When resolving conflicts, start from upstream's version and reapply MANTL's intent. Do not
restore the old MANTL hunk wholesale. If upstream now covers a MANTL change, remove the MANTL
version and its divergence row. After merging, update the
[Upstream divergences](#upstream-divergences) table and check that each seam still lands where
its MANTL code expects it. If `bun run ci` reports a changed dynamic owner, renew it as
described in [Pinned design exceptions](#pinned-design-exceptions).

Upstream's repository automation (PR readiness, rebase, CI fix, issue triage, and the weekly
React Effect review) needs secrets that `myfintech/chopin` does not have. Those workflows are
disabled in the repository's Actions settings, not by editing their files. When a push to
`main` changes `.github/workflows`, the sync workflow disables every active workflow except
`ci.yml` and `mantl-*.yml`. Re-enable a new upstream workflow with `gh workflow enable` only
if it can run here. A new upstream workflow may still run once on the push that brings it in.

### Setup

The sync workflow runs in two jobs. `resolve` merges, installs, runs the checks, and runs
Claude, so it executes upstream's code and dependency scripts. It holds only a read-only
`GITHUB_TOKEN` and the gateway key. `publish` holds the App token, never installs or runs
repository code, and receives the result as a git bundle. It needs:

- A GitHub App installed on `myfintech/chopin` with Contents, Pull requests, Issues, and
  Workflows read and write access. Its ID goes in the `UPSTREAM_SYNC_APP_ID` repository
  variable and its private key in the `UPSTREAM_SYNC_APP_PRIVATE_KEY` secret. `GITHUB_TOKEN`
  cannot push changes to workflow files, and its pushes do not start CI.
- An `UPSTREAM_SYNC_GATEWAY_KEY` secret: a LiteLLM virtual key for the MANTL LLM gateway
  (`https://llm-gateway.mantl.engineering`), the same gateway Chopin's Planner uses. Claude
  Code reaches it with `ANTHROPIC_BASE_URL` and runs `claude-opus-5-5`, with
  `claude-haiku-5-5` as its background model. Code in the `resolve` job can read this key, so
  issue one for this workflow alone, limited to those two models and given a monthly budget. Do not reuse Chopin's deployment key. Rotate it if a sync
  run ever looks wrong.
- Branch protection on `main` that blocks force-pushes and requires the `ci` checks.

## Pinned design exceptions

`bun run ci` runs `scripts/check-design-contract.ts`. It checks that every colour, radius,
shadow, type size, and motion value in `apps/` and `packages/` comes from a theme token. A
value computed at runtime, such as a `className` prop passed through or a colour from a
handle, is allowed only by an exact exception in `scripts/design-contract/exceptions/*.json`.
Each of those exceptions is pinned to a `sourceHash`, the SHA-256 of the whole file.

**Any edit to a pinned file breaks CI, even a one-line seam that has nothing to do with
styling.** The error reads `reviewed dynamic owner changed; inspect its data flow and renew
the exact exception`. This happens when MANTL adds a seam to such a file, and after an
upstream merge where upstream changed a file MANTL also edits. `plan-editor.tsx`, `project-sidebar.tsx`, and
`code-view.tsx` are pinned files that MANTL edits today.

To renew:

1. Run `bun scripts/check-design-contract.ts --inventory` and find the flagged file. Each
   finding shows the dynamic value and the file's current `sourceHash`.
2. Check that the value still comes from where the exception's `reason` says. The hash exists
   to force this review. Never update a hash without looking.
3. Set `sourceHash` to the new value. It equals `sha256sum <file>`.
4. Record it in the `dynamic-{web,editor}.json` row of [Upstream divergences](#upstream-divergences).

Where exceptions live:

- **Upstream files:** keep the exception in upstream's JSON and change only its
  `sourceHash`. That keeps the hunk to one line.
- **MANTL-owned files:** put the exception in a MANTL-owned JSON file named for the feature,
  such as `exceptions/document-authorship.json`, and list it in `exceptions.json`.

Avoid needing one where you can: use theme tokens, keep `style` objects to literal geometry,
and pass an identity colour as `color` and draw with `currentcolor`. A runtime custom
property needs a token fallback, or `scripts/check-tokens.ts` fails.

Two other upstream checks catch MANTL UI work:

- `apps/web/src/focus.test.ts` rejects any component `:focus` outline rule. The theme owns
  focus styling.
- `apps/web/src/icon-tooltip.tsx` gives every icon-only button a tooltip from its
  `aria-label`. Gutter controls that open their own card belong in its exclusion list.

## Upstream divergences

| Path                                                                        | Kind                | Purpose                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MANTL.md`                                                                  | MANTL-owned file    | MANTL rules, upstream sync workflow, divergence list                                                                                                                                                                                                                                         |
| `.github/workflows/mantl-deploy.yml`                                        | MANTL-owned file    | Deploys `main` to GCP after CI passes; infrastructure and setup are in `myfintech/ai` `infra/chopin`                                                                                                                                                                                         |
| `.github/workflows/mantl-upstream-sync.yml`                                 | MANTL-owned file    | Merges upstream into a pull request with Claude resolving conflicts; disables new upstream workflows                                                                                                                                                                                         |
| `AGENTS.md`                                                                 | Upstream file, seam | Notice under the H1 pointing agents to this file                                                                                                                                                                                                                                             |
| `apps/server/src/planner-extensions/`                                       | MANTL-owned files   | [Planner extensions](docs/planner-extensions.md): MCP tools, skills, instructions                                                                                                                                                                                                            |
| `docs/planner-extensions.md`                                                | MANTL-owned file    | Planner extensions configuration and security model                                                                                                                                                                                                                                          |
| `apps/server/src/pi-providers/`                                             | MANTL-owned files   | [Pi providers](docs/pi-providers.md): models missing from Pi's catalog                                                                                                                                                                                                                       |
| `apps/server/config/pi-providers.mantl.jsonc`                               | MANTL-owned file    | Pi provider configuration for the MANTL LLM gateway                                                                                                                                                                                                                                          |
| `apps/server/config/planner-extensions.mantl.jsonc`                         | MANTL-owned file    | Planner extensions (Unblocked, Notion) for the deployed instance; `PLANNER_EXTENSIONS` points here                                                                                                                                                                                           |
| `docs/pi-providers.md`                                                      | MANTL-owned file    | Pi providers configuration and value research method                                                                                                                                                                                                                                         |
| `apps/server/src/pi-redelivery/`                                            | MANTL-owned files   | Resubmits host tool results `@ai-sdk/harness-pi` drops when they arrive before Pi waits for them; drop once fixed upstream                                                                                                                                                                   |
| `apps/server/src/harness-trace.debug.ts`                                    | MANTL-owned file    | Temporary host-tool boundary tracing; remove with its seam in `harnesses.ts`                                                                                                                                                                                                                 |
| `apps/server/src/harness/tool-names.ts`                                     | Upstream file, seam | Import plus one `push` appending configured tool names                                                                                                                                                                                                                                       |
| `apps/server/src/harness/agents.ts`                                         | Upstream file, seam | Extension placeholders in the tool set; `extensionTools` call option merged in `prepareCall`; provenance: `agentTools` wraps upstream's `reporting(scopedJobTools(...))` in `prepareCall`                                                                                                    |
| `apps/server/src/harness/session.ts`                                        | Upstream file, seam | Binds `extensionTools` for the repository when a Planner session opens                                                                                                                                                                                                                       |
| `apps/server/src/harness/harnesses.ts`                                      | Upstream file, seam | Closes extension MCP clients in `shutdownHarnesses`; wraps the Pi adapter with `redeliverToolResults` and passes it `piProviders()`                                                                                                                                                          |
| `apps/server/src/agent/planner.ts`                                          | Upstream file, seam | Appends `extensionInstructions` to the Planner prompt                                                                                                                                                                                                                                        |
| `Dockerfile`                                                                | Upstream file, seam | One block in the runtime stage adding Node.js (`npx`), `uv`/`uvx`, and `python3`                                                                                                                                                                                                             |
| `docs/color-theme.md`                                                       | MANTL-owned file    | [Color theme](docs/color-theme.md): light, dark, and system theme with a saved preference                                                                                                                                                                                                    |
| `apps/server/src/user-preferences/`                                         | MANTL-owned files   | Preference store (memory and PostgreSQL) and `/api/preferences` routes                                                                                                                                                                                                                       |
| `apps/server/src/storage/postgres/migrations/mantl_user_preferences.sql`    | MANTL-owned file    | `user_preferences` table; named, not numbered, so it never collides with upstream's next migration                                                                                                                                                                                           |
| `apps/server/src/storage/postgres/migrations.ts`                            | Upstream file, seam | Appends the `mantl_user_preferences` entry to `MIGRATIONS` after upstream's last entry (now `016_persistent_sessions`); keep it last after an upstream merge; provenance: appends the `mantl_document_provenance` entry after `mantl_user_preferences`; keep both last                       |
| `apps/server/src/storage/postgres/adapter.test.ts`                          | Upstream file, seam | Appends `mantl_user_preferences` to the expected migration list; provenance: lists `mantl_document_provenance` (sorted by id) in the expected migrations                                                                                                                                     |
| `apps/server/src/storage/port.ts`                                           | Upstream file, seam | Import plus `preferences` on `StorageAdapter`; provenance: `provenance` store on `StorageAdapter`                                                                                                                                                                                            |
| `apps/server/src/storage/postgres/adapter.ts`                               | Upstream file, seam | Imports and constructs `PostgresPreferenceStore`; provenance: constructs the store; records provenance inside `#commit` and channel creation transactions                                                                                                                                    |
| `apps/server/src/storage/memory/adapter.ts`                                 | Upstream file, seam | Imports and constructs `MemoryPreferenceStore`; provenance: constructs the store; records in `#commit` and creation; forgets on channel delete                                                                                                                                               |
| `apps/server/src/main.ts`                                                   | Upstream file, seam | Registers `registerPreferenceRoutes` after the navigation routes; provenance: socket frames run through `DocumentProvenance.receive` for lapsing human scopes; `provenance:authorship` and `provenance:restore` cases call `ProvenanceSocket`, and `provenance:authorship` is viewer-allowed |
| `apps/web/src/color-theme*.ts`, `theme-toggle.tsx`, `dark-theme.css`        | MANTL-owned files   | Theme boot, store, toggle, and dark token values                                                                                                                                                                                                                                             |
| `apps/web/bundle-budget.mantl.ts`                                           | MANTL-owned file    | Initial JavaScript allowance for MANTL code above upstream's `INITIAL_JAVASCRIPT_BUDGET`, derived from it                                                                                                                                                                                    |
| `apps/web/vite.config.ts`                                                   | Upstream file, seam | Passes `MANTL_INITIAL_JAVASCRIPT_BUDGET` to `initialJavaScriptBudget()`                                                                                                                                                                                                                      |
| `apps/web/src/main.tsx`                                                     | Upstream file, seam | Calls `bootColorTheme()` and imports `dark-theme.css`                                                                                                                                                                                                                                        |
| `apps/web/src/project-sidebar.tsx`                                          | Upstream file, seam | Renders `<ThemeToggle />` as the sidebar header's last child                                                                                                                                                                                                                                 |
| `packages/editor/src/color-scheme.ts`                                       | MANTL-owned file    | `useColorScheme()` for views that paint their own colors                                                                                                                                                                                                                                     |
| `packages/editor/src/widgets/code-view.tsx`                                 | Upstream file, seam | Code and diff previews use a light/dark theme pair and the resolved scheme                                                                                                                                                                                                                   |
| `packages/icons/src/theme.tsx`                                              | MANTL-owned file    | Sun, moon, and monitor icons                                                                                                                                                                                                                                                                 |
| `packages/icons/src/index.ts`                                               | Upstream file, seam | One export line for the theme icons                                                                                                                                                                                                                                                          |
| `scripts/design-contract/exceptions/color-theme.json`                       | MANTL-owned file    | Reviewed exceptions for dark token values and the theme icons                                                                                                                                                                                                                                |
| `scripts/design-contract/exceptions.json`                                   | Upstream file, seam | Lists `exceptions/color-theme.json` and `exceptions/document-authorship.json` after upstream's entries                                                                                                                                                                                       |
| `scripts/design-contract/exceptions/dynamic-{web,editor}.json`              | Upstream file, seam | Renewed `sourceHash` for `project-sidebar.tsx`, `code-view.tsx`, and `plan-editor.tsx`; recompute after any upstream merge that changes any of them                                                                                                                                          |
| `e2e/theme-toggle.e2e.ts`                                                   | MANTL-owned file    | Toggle placement, cycling, system default, and restore on a new sign-in                                                                                                                                                                                                                      |
| `docs/document-provenance.md`                                               | MANTL-owned file    | [Document provenance](docs/document-provenance.md): who changed each block, human or agent                                                                                                                                                                                                   |
| `apps/server/src/document-provenance/`                                      | MANTL-owned files   | Block diffing, coalescing, actor scopes, memory and PostgreSQL stores, authorship reads, and block restore                                                                                                                                                                                   |
| `apps/server/src/storage/postgres/migrations/mantl_document_provenance.sql` | MANTL-owned file    | `document_changes` table; named, not numbered                                                                                                                                                                                                                                                |
| `apps/server/src/storage/model.ts`                                          | Upstream file, seam | Optional `provenance` on `CommitChannel` and `InitialChannel`                                                                                                                                                                                                                                |
| `apps/server/src/plan/service.ts`                                           | Upstream file, seam | `commitField` and `creationField` spreads; `take` splits browser batches by author; `browser` wraps the batch commit                                                                                                                                                                         |
| `apps/server/src/chat/service.ts`                                           | Upstream file, seam | Both `run` calls go through `plannerTurn`                                                                                                                                                                                                                                                    |
| `apps/server/src/conversation-plan/processor-outbox.ts`                     | Upstream file, seam | `runEffects` wrapped by `plannerAuthored`                                                                                                                                                                                                                                                    |
| `apps/server/src/mcp/hosted.ts`                                             | Upstream file, seam | MCP creation and rewrite wrapped by `codingAgent`                                                                                                                                                                                                                                            |
| `apps/server/src/research/publication.ts`                                   | Upstream file, seam | Research child creation wrapped by `plannerAuthored`                                                                                                                                                                                                                                         |
| `packages/protocol/provenance.d.ts`                                         | MANTL-owned file    | `provenance:authorship` and `provenance:restore` frames                                                                                                                                                                                                                                      |
| `packages/protocol/index.d.ts`                                              | Upstream file, seam | Exports `Provenance` and adds its frames to `Incoming` and `Outgoing`                                                                                                                                                                                                                        |
| `packages/editor/src/authorship/`                                           | MANTL-owned files   | Authorship margin: store, margin layer and card, contributor strip, header toggle                                                                                                                                                                                                            |
| `packages/editor/src/plan-editor.tsx`                                       | Upstream file, seam | Optional `authorship` prop: binds the store, connects it, adds `authorshipPlugin`, renders the strip and layer                                                                                                                                                                               |
| `packages/editor/src/index.ts`                                              | Upstream file, seam | Exports `AuthorshipStore`, `AuthorshipToggle`, and `AuthorshipView`                                                                                                                                                                                                                          |
| `apps/web/src/room-workspace.tsx`                                           | Upstream file, seam | Creates the `AuthorshipStore`; optional `tools` slot on `Header` holds `AuthorshipToggle`; passes the store to `PlanEditor`                                                                                                                                                                  |
| `apps/web/src/icon-tooltip.tsx`                                             | Upstream file, seam | `.authorship-lane` joins the gutter markers that never get an icon tooltip                                                                                                                                                                                                                   |
| `scripts/design-contract/exceptions/document-authorship.json`               | MANTL-owned file    | Reviewed identity-colour exceptions for authorship bars and agent faces                                                                                                                                                                                                                      |
