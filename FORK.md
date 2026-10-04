# Working on the myfintech fork

This repository, [myfintech/chopin](https://github.com/myfintech/chopin), is a downstream
fork of [githubnext/chopin](https://github.com/githubnext/chopin). We regularly rebase it onto
upstream. Fork commits sit on top of `upstream/main` and are replayed after each upstream update.

**Core principle: every change must survive repeated upstream rebases.** Keep the fork's diff
against upstream as small, isolated, and easy to understand as possible. A clever change
that conflicts on every rebase costs more than a plain change that never conflicts.

[AGENTS.md](AGENTS.md) is upstream's guide and still applies to architecture, security,
testing, and conventions. This file adds fork rules. If the two conflict, follow this file.

## Remotes

| Remote     | Repository          | Role                                     |
| ---------- | ------------------- | ---------------------------------------- |
| `origin`   | `myfintech/chopin`  | The fork; our branches and pull requests |
| `upstream` | `githubnext/chopin` | Source project; read-only for us         |

Open fork pull requests against `origin`. Never push to `upstream`.

## Rebase-friendly change rules

1. **Add instead of modifying.** Prefer new files, modules, components, routes, scripts,
   skills, and docs over edits to upstream-owned files. A new file never conflicts.
2. **When an upstream file must change, add a thin seam.** Keep the hunk minimal, for
   example one import plus one call, registration, or option that delegates to fork-owned
   code. Put the logic in the fork-owned file, not inline.
3. **Do not churn upstream code.** Do not reformat, rename, reorder, move, or re-indent
   upstream code, and do not apply opportunistic lint or style fixes to it. Match upstream
   conventions exactly so `bun run fix` produces no unrelated diffs in upstream files.
4. **Do not refactor upstream code for taste.** Refactor upstream code only when a fork
   feature needs it. Keep that refactor in its own commit so it is easy to drop or send
   upstream.
5. **Preserve upstream defaults.** New behavior should be opt-in through configuration,
   environment variables, or feature flags. When the setting is absent, upstream behavior
   should stay unchanged.
6. **Keep the wire and storage compatible.** Add optional protocol fields instead of changing
   existing ones. Never edit an upstream migration. Upstream numbers migrations sequentially,
   and the runner in `apps/server/src/storage/postgres/migrations.ts` rejects unknown or
   changed migrations. A fork migration can collide with upstream's next number. Stop and ask
   before adding a schema change.
7. **Minimize dependency changes.** Avoid adding or bumping dependencies in `package.json`.
   After a rebase, regenerate `bun.lock` with `bun install` instead of hand-merging it.
8. **Keep fork docs separate.** Put fork documentation in fork-owned files such as this one
   or a new `docs/fork-*.md`. Limit `AGENTS.md`, `README.md`, and other upstream docs to short
   pointers to fork files.
9. **Make fixes upstream-ready.** If a change is broadly useful, such as a bug fix, write it as
   a standalone commit that could become an upstream pull request. Once upstream merges an
   equivalent change, drop the fork commit.
10. **Record every divergence.** When you add a fork-owned file or edit an upstream file, add
    a row to [Fork divergences](#fork-divergences). This is the checklist for each rebase.

## Commits

- Keep each commit to one purpose. Keep mechanical changes separate from behavioral ones.
  Keep upstream-file seams in the same commit as the fork code they call.
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

When resolving conflicts, start from upstream's version and reapply the fork's intent. Do not
restore the old fork hunk wholesale. If upstream has already covered a fork commit, drop it
with `git rebase --skip`. After rebasing, update the [Fork divergences](#fork-divergences)
table and check that each seam still lands where its fork code expects it.

## Fork divergences

| Path                                          | Kind                | Purpose                                                                                                                             |
| --------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `FORK.md`                                     | Fork-owned file     | Fork rules, rebase workflow, divergence list                                                                                        |
| `AGENTS.md`                                   | Upstream file, seam | Notice under the H1 pointing agents to this file                                                                                    |
| `apps/server/src/fork/planner-extensions/`    | Fork-owned files    | [Planner extensions](docs/fork-planner-extensions.md): MCP tools, skills, instructions                                              |
| `docs/fork-planner-extensions.md`             | Fork-owned file     | Planner extensions configuration and security model                                                                                 |
| `apps/server/src/fork/pi-providers/`          | Fork-owned files    | [Pi providers](docs/fork-pi-providers.md): models missing from Pi's catalog                                                         |
| `apps/server/config/pi-providers.mantl.jsonc` | Fork-owned file     | Pi provider configuration for the MANTL LLM gateway                                                                                 |
| `docs/fork-pi-providers.md`                   | Fork-owned file     | Pi providers configuration and value research method                                                                                |
| `apps/server/src/fork/pi-redelivery/`         | Fork-owned files    | Resubmits host tool results `@ai-sdk/harness-pi` drops when they arrive before Pi waits for them; drop once fixed upstream          |
| `apps/server/src/harness/tool-names.ts`       | Upstream file, seam | Import plus one `push` appending configured tool names                                                                              |
| `apps/server/src/harness/agents.ts`           | Upstream file, seam | Extension placeholders in the tool set; `extensionTools` call option merged in `prepareCall`                                        |
| `apps/server/src/harness/session.ts`          | Upstream file, seam | Binds `extensionTools` for the repository when a Planner session opens                                                              |
| `apps/server/src/harness/harnesses.ts`        | Upstream file, seam | Closes extension MCP clients in `shutdownHarnesses`; wraps the Pi adapter with `redeliverToolResults` and passes it `piProviders()` |
| `apps/server/src/agent/planner.ts`            | Upstream file, seam | Appends `extensionInstructions` to the Planner prompt                                                                               |
| `Dockerfile`                                  | Upstream file, seam | One block in the runtime stage adding Node.js (`npx`), `uv`/`uvx`, and `python3`                                                    |
