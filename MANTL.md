# Working on MANTL's Chopin

This repository, [myfintech/chopin](https://github.com/myfintech/chopin), is MANTL's downstream
copy of [githubnext/chopin](https://github.com/githubnext/chopin). We regularly rebase it onto
upstream. MANTL commits sit on top of `upstream/main` and are replayed after each upstream update.

**Core principle: every change must survive repeated upstream rebases.** Keep MANTL's diff
against upstream as small, isolated, and easy to understand as possible. A clever change
that conflicts on every rebase costs more than a plain change that never conflicts.

[AGENTS.md](AGENTS.md) is upstream's guide and still applies to architecture, security,
testing, and conventions. This file adds MANTL rules. If the two conflict, follow this file.

## Remotes

| Remote     | Repository          | Role                                    |
| ---------- | ------------------- | --------------------------------------- |
| `origin`   | `myfintech/chopin`  | MANTL's; our branches and pull requests |
| `upstream` | `githubnext/chopin` | Source project; read-only for us        |

Open MANTL pull requests against `origin`. Never push to `upstream`.

## Rebase-friendly change rules

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
   After a rebase, regenerate `bun.lock` with `bun install` instead of hand-merging it.
8. **Keep MANTL docs separate.** Put MANTL documentation in MANTL-owned files such as this
   one or a new `docs/*.md` named for its feature. Limit `AGENTS.md`, `README.md`, and other
   upstream docs to short pointers to MANTL files.
9. **Make fixes upstream-ready.** If a change is broadly useful, such as a bug fix, write it as
   a standalone commit that could become an upstream pull request. Once upstream merges an
   equivalent change, drop the MANTL commit.
10. **Record every divergence.** When you add a MANTL-owned file or edit an upstream file, add
    a row to [Upstream divergences](#upstream-divergences). This is the checklist for each rebase.

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
- Squash fixups before merging. Fewer, coherent commits replay more cleanly.

## Rebasing onto upstream

Agents must not rebase shared branches or push, including force-push, unless the user
explicitly asks. The usual flow is:

```bash
git fetch upstream
git rebase upstream/main
bun install            # regenerate bun.lock if dependencies changed
bun run types
bun test
bun run ci
git push --force-with-lease origin main
```

When resolving conflicts, start from upstream's version and reapply MANTL's intent. Do not
restore the old MANTL hunk wholesale. If upstream has already covered a MANTL commit, drop it
with `git rebase --skip`. After rebasing, update the [Upstream divergences](#upstream-divergences)
table and check that each seam still lands where its MANTL code expects it. If `bun run ci`
reports a changed dynamic owner, renew it as described in
[Pinned design exceptions](#pinned-design-exceptions).

## Pinned design exceptions

`bun run ci` runs `scripts/check-design-contract.ts`. It checks that every colour, radius,
shadow, type size, and motion value in `apps/` and `packages/` comes from a theme token. A
value computed at runtime, such as a `className` prop passed through or a colour from a
handle, is allowed only by an exact exception in `scripts/design-contract/exceptions/*.json`.
Each of those exceptions is pinned to a `sourceHash`, the SHA-256 of the whole file.

**Any edit to a pinned file breaks CI, even a one-line seam that has nothing to do with
styling.** The error reads `reviewed dynamic owner changed; inspect its data flow and renew
the exact exception`. This happens when MANTL adds a seam to such a file, and after a rebase
where upstream changed a file MANTL also edits. `plan-editor.tsx`, `project-sidebar.tsx`, and
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
| `MANTL.md`                                                                  | MANTL-owned file    | MANTL rules, rebase workflow, divergence list                                                                                                                                                                                                                                                |
| `.github/workflows/mantl-deploy.yml`                                        | MANTL-owned file    | Deploys `main` to GCP after CI passes; infrastructure and setup are in `myfintech/ai` `infra/chopin`                                                                                                                                                                                         |
| `AGENTS.md`                                                                 | Upstream file, seam | Notice under the H1 pointing agents to this file                                                                                                                                                                                                                                             |
| `apps/server/src/planner-extensions/`                                       | MANTL-owned files   | [Planner extensions](docs/planner-extensions.md): MCP tools, skills, instructions                                                                                                                                                                                                            |
| `docs/planner-extensions.md`                                                | MANTL-owned file    | Planner extensions configuration and security model                                                                                                                                                                                                                                          |
| `apps/server/src/pi-providers/`                                             | MANTL-owned files   | [Pi providers](docs/pi-providers.md): models missing from Pi's catalog                                                                                                                                                                                                                       |
| `apps/server/config/pi-providers.mantl.jsonc`                               | MANTL-owned file    | Pi provider configuration for the MANTL LLM gateway                                                                                                                                                                                                                                          |
| `docs/pi-providers.md`                                                      | MANTL-owned file    | Pi providers configuration and value research method                                                                                                                                                                                                                                         |
| `apps/server/src/pi-redelivery/`                                            | MANTL-owned files   | Resubmits host tool results `@ai-sdk/harness-pi` drops when they arrive before Pi waits for them; drop once fixed upstream                                                                                                                                                                   |
| `apps/server/src/harness-trace.debug.ts`                                    | MANTL-owned file    | Temporary host-tool boundary tracing; remove with its seam in `harnesses.ts`                                                                                                                                                                                                                 |
| `apps/server/src/harness/tool-names.ts`                                     | Upstream file, seam | Import plus one `push` appending configured tool names                                                                                                                                                                                                                                       |
| `apps/server/src/harness/agents.ts`                                         | Upstream file, seam | Extension placeholders in the tool set; `extensionTools` call option merged in `prepareCall`; provenance: planner tools wrapped by `agentTools` in `prepareCall`                                                                                                                             |
| `apps/server/src/harness/session.ts`                                        | Upstream file, seam | Binds `extensionTools` for the repository when a Planner session opens                                                                                                                                                                                                                       |
| `apps/server/src/harness/harnesses.ts`                                      | Upstream file, seam | Closes extension MCP clients in `shutdownHarnesses`; wraps the Pi adapter with `redeliverToolResults` and passes it `piProviders()`                                                                                                                                                          |
| `apps/server/src/agent/planner.ts`                                          | Upstream file, seam | Appends `extensionInstructions` to the Planner prompt                                                                                                                                                                                                                                        |
| `Dockerfile`                                                                | Upstream file, seam | One block in the runtime stage adding Node.js (`npx`), `uv`/`uvx`, and `python3`                                                                                                                                                                                                             |
| `docs/color-theme.md`                                                       | MANTL-owned file    | [Color theme](docs/color-theme.md): light, dark, and system theme with a saved preference                                                                                                                                                                                                    |
| `apps/server/src/user-preferences/`                                         | MANTL-owned files   | Preference store (memory and PostgreSQL) and `/api/preferences` routes                                                                                                                                                                                                                       |
| `apps/server/src/storage/postgres/migrations/mantl_user_preferences.sql`    | MANTL-owned file    | `user_preferences` table; named, not numbered, so it never collides with upstream's next migration                                                                                                                                                                                           |
| `apps/server/src/storage/postgres/migrations.ts`                            | Upstream file, seam | Appends the `mantl_user_preferences` entry to `MIGRATIONS`; keep it last after a rebase; provenance: appends the `mantl_document_provenance` entry after `mantl_user_preferences`; keep both last                                                                                            |
| `apps/server/src/storage/postgres/adapter.test.ts`                          | Upstream file, seam | Appends `mantl_user_preferences` to the expected migration list; provenance: lists `mantl_document_provenance` (sorted by id) in the expected migrations                                                                                                                                     |
| `apps/server/src/storage/port.ts`                                           | Upstream file, seam | Import plus `preferences` on `StorageAdapter`; provenance: `provenance` store on `StorageAdapter`                                                                                                                                                                                            |
| `apps/server/src/storage/postgres/adapter.ts`                               | Upstream file, seam | Imports and constructs `PostgresPreferenceStore`; provenance: constructs the store; records provenance inside `#commit` and channel creation transactions                                                                                                                                    |
| `apps/server/src/storage/memory/adapter.ts`                                 | Upstream file, seam | Imports and constructs `MemoryPreferenceStore`; provenance: constructs the store; records in `#commit` and creation; forgets on channel delete                                                                                                                                               |
| `apps/server/src/main.ts`                                                   | Upstream file, seam | Registers `registerPreferenceRoutes` after the navigation routes; provenance: socket frames run through `DocumentProvenance.receive` for lapsing human scopes; `provenance:authorship` and `provenance:restore` cases call `ProvenanceSocket`, and `provenance:authorship` is viewer-allowed |
| `apps/web/src/color-theme*.ts`, `theme-toggle.tsx`, `dark-theme.css`        | MANTL-owned files   | Theme boot, store, toggle, and dark token values                                                                                                                                                                                                                                             |
| `apps/web/src/main.tsx`                                                     | Upstream file, seam | Calls `bootColorTheme()` and imports `dark-theme.css`                                                                                                                                                                                                                                        |
| `apps/web/src/project-sidebar.tsx`                                          | Upstream file, seam | Renders `<ThemeToggle />` as the sidebar header's last child                                                                                                                                                                                                                                 |
| `packages/editor/src/color-scheme.ts`                                       | MANTL-owned file    | `useColorScheme()` for views that paint their own colors                                                                                                                                                                                                                                     |
| `packages/editor/src/widgets/code-view.tsx`                                 | Upstream file, seam | Code and diff previews use a light/dark theme pair and the resolved scheme                                                                                                                                                                                                                   |
| `packages/icons/src/theme.tsx`                                              | MANTL-owned file    | Sun, moon, and monitor icons                                                                                                                                                                                                                                                                 |
| `packages/icons/src/index.ts`                                               | Upstream file, seam | One export line for the theme icons                                                                                                                                                                                                                                                          |
| `scripts/design-contract/exceptions/color-theme.json`                       | MANTL-owned file    | Reviewed exceptions for dark token values and the theme icons                                                                                                                                                                                                                                |
| `scripts/design-contract/exceptions.json`                                   | Upstream file, seam | Lists `exceptions/color-theme.json` and `exceptions/document-authorship.json`                                                                                                                                                                                                                |
| `scripts/design-contract/exceptions/dynamic-{web,editor}.json`              | Upstream file, seam | Renewed `sourceHash` for `project-sidebar.tsx`, `code-view.tsx`, and `plan-editor.tsx`; recompute after any rebase that changes any of them                                                                                                                                                  |
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
