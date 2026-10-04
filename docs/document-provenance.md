# Document provenance

Document provenance records who changed each top-level block of a document, and
whether that author was a person, an agent, or the system. It is recorded beside
the document and never enters the MDX, so exporting a document produces the same
bytes whether provenance is on or off.

This change only records the data. Nothing in the browser shows it yet.

## Enabling

Provenance is off by default. Set `DOCUMENT_PROVENANCE=on` to turn it on. When the
variable is absent or set to anything else, nothing is recorded and browser edits
are batched exactly as upstream batches them.

The `mantl_document_provenance` migration creates the `document_changes` table
whether or not the feature is on.

## What is recorded

Each row of `document_changes` is one burst of changes by one actor:

| Column                          | Meaning                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `author_type`                   | `human`, `agent`, or `system`. Use this to tell agent prose from human prose. |
| `actor`                         | Who acted: a user, the Planner, a coding agent, or the server (see below).    |
| `via`                           | `browser`, `server`, `mcp`, or `creation`: how the change arrived.            |
| `from_revision` / `to_revision` | The plan revisions the burst spans.                                           |
| `started_at` / `ended_at`       | When the burst started and when it last changed.                              |
| `blocks`                        | The block changes in the burst (see below).                                   |

Each entry in `blocks` is one top-level block:

```json
{
	"kind": "modified",
	"fromRevision": 412,
	"toRevision": 419,
	"before": {
		"index": 7,
		"digest": "sha256:…",
		"source": "The service retries failed jobs three times.\n"
	},
	"after": {
		"index": 7,
		"digest": "sha256:…",
		"source": "The service retries failed requests five times.\n"
	}
}
```

- `kind` is `added`, `removed`, `modified`, or `moved`.
- `source` is the block's canonical MDX. `digest` uses the same hash as room
  anchors, so a later consumer can match a block to an anchor.
- `index` is the block's position in the anchor address space. Treat it as a
  hint; the digest is the identity.
- Revisions are kept per block, not only per entry. A burst can stay open while
  someone else edits, so replaying one block's history orders by these.

Blame at word level is computed when it is needed, by diffing the words of a
block's `before` and `after` text. Storing whole block texts rather than spans
lets that logic change without rewriting history.

## Actors

| `actor.kind`   | `author_type` | Recorded when                                                                                                                                                                                                                                            |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`         | `human`       | A browser edit from that person's socket (`via: "browser"`). Also server-applied changes from a person's own decision: question edits, submissions, cancellations, reopenings, discards, added options, and conversation-card choices (`via: "server"`). |
| `planner`      | `agent`       | Any Planner tool call, any Planner turn (with `requestedBy` for a person's message, or `job` for background work), conversation-card effects, and research child documents.                                                                              |
| `coding-agent` | `agent`       | An MCP document creation or rewrite. Records the GitHub user behind the bearer token and the MCP client name and version.                                                                                                                                |
| `server`       | `system`      | Anything else, such as backfills and research reference placement.                                                                                                                                                                                       |

### How attribution reaches the commit

Browser edits are attributed exactly, from the authenticated socket that sent
them. When provenance is on, each 5 ms batch is split into consecutive runs by
author. Arrival order is kept, so no update commits before one it depends on.

Server-applied changes reach storage through about twenty call sites. Rather
than change each of them, the actor rides on `AsyncLocalStorage`, set at a few
entry points:

- **Agent scopes** are set around every Planner turn, every Planner tool, the
  conversation-card effect runner, MCP operations, and research publication.
  Tools are wrapped individually because a harness may call them from callbacks
  that carry another scope.
- **Human scopes** are set only for the socket frames listed above, and they
  lapse when that frame's handler returns. Work the handler merely started, such
  as a timer or a queued job, cannot inherit a person's identity.
- With no live scope, a change is attributed to the system.

The rule is that an agent edit is never credited to a person. A mistake in the
other direction labels a person's change as `system`, not `agent`.

## Coalescing

Typing produces many small commits. A commit joins the actor's latest entry when
the actor and route match, the entry changed within the last 30 seconds, and the
entry started less than 10 minutes ago. Otherwise a new entry starts. An entry
also closes once it reaches 200 blocks or 256 KiB.

Within an entry, a block keeps its first `before` and takes the latest `after`.
If another author changed the block in between, the actor's next edit is added
as a separate block change with its own revisions, rather than merged across the
other author's work. A block the actor added and then removed disappears from
the entry.

## Durability

The row is written inside the same fenced transaction as the collaboration
commit, after the operation idempotency check. A retried operation never records
twice, and a provenance row can never exist without its document change. Rows
are deleted with their channel.

Documents created with content (MCP creation and research child documents)
record a revision-zero `creation` entry in their creation transaction. Documents
created empty in the browser have nothing to record until their first edit.

If a source cannot be split into blocks, the document change still commits
without provenance and a warning is logged. Attribution never blocks an edit.

## Limits

- Detail is per top-level block. A list, table, or callout is one block.
- An epoch rebuild after an invalid browser batch restores the last committed
  state, so it records nothing.
- Nothing is recorded for changes made before the feature was turned on.
- Rows are never pruned while the channel exists. Account for this in database
  monitoring and backups, as for other channel history.
- `bun run test:postgres` covers `apps/server/src/storage/postgres` only. Run
  `apps/server/src/document-provenance/postgres.test.ts` with `TEST_DATABASE_URL`
  set to exercise the PostgreSQL store.

## Reading

`storage.provenance.list(channelId, limit, after?)` returns entries ordered by
start time, with a `next` cursor. No HTTP or WebSocket route exposes it yet.
