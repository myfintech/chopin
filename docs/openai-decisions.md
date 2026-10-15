# OpenAI Decisions in place of Jev

> MANTL-owned feature. See [MANTL.md](../MANTL.md). Upstream behavior is unchanged when
> `OPENAI_DECISIONS_API_KEY` is unset.

Upstream sends small judgment calls to TypeSafe's Jev service and refuses to start with the
Planner enabled unless `JEV_API_KEY` is set. The main caller is
[automatic participation](conversation-initiative.md): when more than one person is chatting,
Jev decides whether Chopin should answer, give way, or wait. With `OPENAI_DECISIONS_API_KEY`
set, every Jev request goes to the
[OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions) instead, under
MANTL's OpenAI Enterprise agreement. Nothing goes to TypeSafe.

| Variable                    | Default                     | Meaning                                                    |
| --------------------------- | --------------------------- | ---------------------------------------------------------- |
| `OPENAI_DECISIONS_API_KEY`  | unset                       | Enables the replacement and satisfies the startup check.   |
| `OPENAI_DECISIONS_BASE_URL` | `https://api.openai.com/v1` | API base; `/decisions` is appended. Point it at a gateway. |
| `OPENAI_DECISIONS_MODEL`    | `gpt-6-luna`                | The only model the Decisions API supports today.           |

`JEV_MODEL`, `CONVERSATION_INITIATIVE_MODEL`, and the model a caller names are Jev aliases and
are ignored. `JEV_TIMEOUT_MS` still bounds each request.

## How a request maps

`askJev` in `apps/server/src/conversation-plan/jev.ts` validates the request's bounds as
always, then hands it to `askDecisions`. Jev's JSON `state` becomes the Decisions `input`
text, and each question keeps its Jev id as its `name`:

| Jev      | Decisions   | Mapping                                                                   |
| -------- | ----------- | ------------------------------------------------------------------------- |
| `noul`   | `predicate` | `true` and `false` criteria are appended to the instructions              |
| `choice` | `choice`    | each criterion becomes a choice's `value` and `description`               |
| `score`  | `score`     | each criterion becomes a level labelled by its index, described by itself |

Answers come back as Jev answers, and upstream's own `validateJevResponse` checks them, so a
Decisions answer must meet the same rules as a Jev one: every question answered, a probability
distribution that sums to one, and a choice that is the most likely. A `refusal`, an HTTP
error, or a malformed answer fails the request the way a Jev failure does, and automatic
participation treats it as a reason not to speak.

## Data and cost

In group conversations the judge receives the latest message, up to ten recent messages, a
document excerpt of up to 6,000 characters, and up to four open decision questions, all under
24,000 characters. A solo conversation skips the judge unless its member has a child
document open. That context goes to OpenAI rather than
TypeSafe; use a dedicated OpenAI project with zero data retention, a budget limit, and a key
for this alone.

At $0.10 per million input tokens and no output charge, a full-size judgment costs about
$0.0006.

## Going through the gateway instead

The MANTL LLM gateway does not serve OpenAI models or `/v1/decisions` today (checked October
2026: `GET /v1/models` lists none, and `POST /v1/decisions` returns 404). If it gains an OpenAI
pass-through for `/v1/decisions`, set `OPENAI_DECISIONS_BASE_URL` to the gateway and
`OPENAI_DECISIONS_API_KEY` to a gateway key; nothing else changes.

## Not covered

`LIVE_BUILD` readiness, the `LIVE_SPIKES` judge, and `tasks/live-gate.ts` decide whether to
ask Jev by checking `JEV_API_KEY` directly, so they behave as if no judge were configured.
MANTL runs neither feature. Add a seam there before enabling them with this replacement.

## Implementation

- Mapping, transport, and conversion: `apps/server/src/openai-decisions/index.ts`
- Seams: `askJev` in `apps/server/src/conversation-plan/jev.ts` returns
  `askDecisions(...)` when `decisionsConfigured()`; `load` in `apps/server/src/config.ts`
  accepts `decisionsConfigured()` wherever it requires `JEV_API_KEY`.
