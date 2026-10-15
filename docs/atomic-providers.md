# Atomic providers

> MANTL-owned feature. See [MANTL.md](../MANTL.md). Upstream behavior is unchanged when
> `ATOMIC_PROVIDERS` is unset.

Under `HARNESS=atomic`, `MODEL` must name a model as `provider/model`, and Chopin refuses one
Atomic's catalog lacks. With `HARNESS_AUTH=ai-gateway`, it also refuses any built-in provider
except `vercel-ai-gateway`. Atomic providers add models the catalog lacks, such as a newer model
a gateway already serves, without changing code or dependencies. `ai-gateway` accepts them,
because the operator configured them.

The file is passed to Chopin's Atomic adapter as its `providers` setting, which registers each
provider with Atomic's model runtime before it resolves `MODEL`. Atomic is built on Pi and shares
Pi's provider format, so this file began as MANTL's Pi providers and moved unchanged when
upstream removed the Pi harness.

## Use the MANTL gateway configuration

[`apps/server/config/atomic-providers.mantl.jsonc`](../apps/server/config/atomic-providers.mantl.jsonc)
defines a `mantl` provider for every chat model the MANTL LLM gateway serves:

| `MODEL`                       | Context   | Max output |
| ----------------------------- | --------- | ---------- |
| `mantl/claude-opus-5-5`       | 1,000,000 | 128,000    |
| `mantl/claude-sonnet-5-5`     | 1,000,000 | 128,000    |
| `mantl/gemini-3.8-flash`      | 1,048,576 | 65,536     |
| `mantl/gemini-3.5-flash-lite` | 1,048,576 | 65,536     |
| `mantl/glm-5.2`               | 1,048,576 | 131,072    |

Grok 4.6 is listed but disabled, because the gateway did not answer its requests when
this was verified. The gateway's image, speech, and music models are not chat models
and are not listed.

```bash
HARNESS=atomic
HARNESS_AUTH=ai-gateway
ATOMIC_PLANNER=isolated  # see docs/isolated-planner.md
AI_GATEWAY_BASE_URL=https://llm-gateway.mantl.engineering
AI_GATEWAY_API_KEY=...
ATOMIC_PROVIDERS=/app/apps/server/config/atomic-providers.mantl.jsonc  # Docker; use your checkout's absolute path locally
MODEL=mantl/claude-opus-5-5
```

The Docker image includes the file at `/app/apps/server/config/atomic-providers.mantl.jsonc`.
Under `ai-gateway`, Atomic's built-in `vercel-ai-gateway/*` models keep working alongside the
custom provider.

## File format

The file is JSON with comments, read once at startup. An invalid file fails startup.
Use an absolute path in `ATOMIC_PROVIDERS`: a relative one resolves against the server
process's working directory, which is `apps/server` under `bun run dev` and `/app` in
the Docker image.

```jsonc
{
	"providers": {
		"<name>": {
			"name": "Display name", // optional
			"baseUrl": "${GATEWAY_URL}",
			"apiKey": "${GATEWAY_KEY}",
			"api": "anthropic-messages",
			"headers": { "X-Team": "${TEAM}" }, // optional
			"models": [/* model entries */],
		},
	},
}
```

- **Provider names** are lowercase letters, digits, and hyphens. `vercel-ai-gateway`,
  `anthropic`, and `openai` are refused, because they are built-in providers a deployment
  may rely on, and a custom entry would replace all of their models.
- **`apiKey`** must be exactly one environment reference such as `${AI_GATEWAY_API_KEY}`.
  The variable must be set at startup. Atomic reads the value itself when it sends a
  request. Literal keys and `!command` keys are refused, so the file holds no secret and
  cannot run a command.
- **`baseUrl` and `headers`** substitute `${NAME}`; a missing variable fails startup.
- **`api`** is `anthropic-messages`, `openai-completions`, `openai-responses`, or
  `google-generative-ai`. A model may override it.

Each model entry:

| Field              | Meaning                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`               | The model name sent to the gateway. Select it as `<provider>/<id>`.                                                                                                      |
| `name`             | Display name.                                                                                                                                                            |
| `reasoning`        | Whether the model supports thinking. Atomic then sends thinking settings.                                                                                                |
| `input`            | `["text"]` or `["text", "image"]`.                                                                                                                                       |
| `contextWindow`    | Input limit in tokens. Atomic uses it for context management.                                                                                                            |
| `maxTokens`        | Output limit. **Atomic sends it as every request's `max_tokens`**, so the backend must accept it. Cannot exceed `contextWindow`.                                         |
| `cost`             | USD per million tokens: `input`, `output`, `cacheRead`, `cacheWrite`, and optional `tiers` (`inputTokensAbove` plus the same four prices). Affects usage reporting only. |
| `thinkingLevelMap` | Optional. Maps thinking levels (`off` … `max`) to provider values; `null` marks a level unsupported.                                                                     |
| `compat`           | Optional compatibility flags, for example `forceAdaptiveThinking`, `supportsTemperature`, or `allowEmptySignature`.                                                      |

## Choosing values

The MANTL file shows the method:

1. Take limits and prices from the gateway. LiteLLM reports what it enforces and bills
   at `GET /model/info`. `GET /v1/models` lists the exact IDs.
2. Fill gaps from the vendor's published model card, and note the source in a comment.
3. Copy behavior flags (`thinkingLevelMap`, `compat`) from the catalog entry for the same
   model behind a similar gateway, in Atomic's `@bastani/pi-ai` or a newer
   `@earendil-works/pi-ai` release, which often already lists models the installed one lacks.
4. Verify each model with a real turn that makes a tool call. Watch for a rejected
   `max_tokens`, an unsupported thinking setting, or no response.

When an Atomic upgrade adds a model to the built-in catalog under an ID the gateway accepts,
remove the custom entry and use the built-in ID.

## Security

The configuration is operator-owned, like `HARNESS_AUTH`. A custom provider sends
Planner and background-job prompts, including document and repository content, to its
`baseUrl`. Configure only endpoints you trust with that data. On a non-loopback
`SERVER_HOST`, Chopin still requires `HARNESS_AUTH=ai-gateway`; a custom provider uses
its own operator key, never a developer's host subscription.

## Implementation

- Loading and validation: `apps/server/src/atomic-providers/index.ts`
- MANTL configuration: `apps/server/config/atomic-providers.mantl.jsonc`
- Seam: `createAtomicHarness` in `apps/server/src/harness/harnesses.ts` passes `providers`.
