# Pi providers (fork)

> Fork-owned feature. See [FORK.md](../FORK.md). Upstream behavior is unchanged when
> `PI_PROVIDERS` is unset.

Under `HARNESS=pi`, `MODEL` must name a model in Pi's built-in catalog, and Chopin's
Pi patch refuses an unknown one. Pi providers add models the catalog lacks, such as a
newer model a gateway already serves, without changing code or dependencies.

The file is passed to `@ai-sdk/harness-pi` as its public `providers` setting. The
harness registers these providers before it resolves `MODEL`. A Pi extension's
`pi.registerProvider()` call is too late, because the harness caches its model
catalog when a session starts.

## Use the MANTL gateway configuration

[`apps/server/config/pi-providers.mantl.jsonc`](../apps/server/config/pi-providers.mantl.jsonc)
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
HARNESS=pi
HARNESS_AUTH=ai-gateway
AI_GATEWAY_BASE_URL=https://llm-gateway.mantl.engineering
AI_GATEWAY_API_KEY=...
PI_PROVIDERS=/app/apps/server/config/pi-providers.mantl.jsonc  # Docker; use your checkout's absolute path locally
MODEL=mantl/claude-opus-5-5
```

The Docker image includes the file at `/app/apps/server/config/pi-providers.mantl.jsonc`.
Models from Pi's built-in catalog, such as `google/gemini-3.8-flash`, keep working
alongside the custom provider.

## File format

The file is JSON with comments, read once at startup. An invalid file fails startup.
Use an absolute path in `PI_PROVIDERS`: a relative one resolves against the server
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
  `anthropic`, and `openai` are refused, because the harness registers them from
  `HARNESS_AUTH` and a custom entry would replace all of their models.
- **`apiKey`** must be exactly one environment reference such as `${AI_GATEWAY_API_KEY}`.
  The variable must be set at startup. Pi reads the value itself when it sends a request.
  Literal keys and Pi's `!command` keys are refused, so the file holds no secret and
  cannot run a command.
- **`baseUrl` and `headers`** substitute `${NAME}`; a missing variable fails startup.
- **`api`** is `anthropic-messages`, `openai-completions`, `openai-responses`, or
  `google-generative-ai`. A model may override it.

Each model entry:

| Field              | Meaning                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`               | The model name sent to the gateway. Select it as `<provider>/<id>`.                                                                                                      |
| `name`             | Display name.                                                                                                                                                            |
| `reasoning`        | Whether the model supports thinking. Pi then sends thinking settings.                                                                                                    |
| `input`            | `["text"]` or `["text", "image"]`.                                                                                                                                       |
| `contextWindow`    | Input limit in tokens. Pi uses it for context management.                                                                                                                |
| `maxTokens`        | Output limit. **Pi sends it as every request's `max_tokens`**, so the backend must accept it. Cannot exceed `contextWindow`.                                             |
| `cost`             | USD per million tokens: `input`, `output`, `cacheRead`, `cacheWrite`, and optional `tiers` (`inputTokensAbove` plus the same four prices). Affects usage reporting only. |
| `thinkingLevelMap` | Optional. Maps Pi thinking levels (`off` … `max`) to provider values; `null` marks a level unsupported.                                                                  |
| `compat`           | Optional Pi compatibility flags, for example `forceAdaptiveThinking`, `supportsTemperature`, or `allowEmptySignature`.                                                   |

## Choosing values

The MANTL file shows the method:

1. Take limits and prices from the gateway. LiteLLM reports what it enforces and bills
   at `GET /model/info`. `GET /v1/models` lists the exact IDs.
2. Fill gaps from the vendor's published model card, and note the source in a comment.
3. Copy behavior flags (`thinkingLevelMap`, `compat`) from Pi's catalog entry for the same
   model behind a similar gateway. A newer `@earendil-works/pi-ai` release often already
   lists models the installed one lacks.
4. Verify each model with a real turn that makes a tool call. Watch for a rejected
   `max_tokens`, an unsupported thinking setting, or no response.

When a Pi upgrade adds a model to the built-in catalog under an ID the gateway accepts,
remove the custom entry and use the built-in ID.

## Security

The configuration is operator-owned, like `HARNESS_AUTH`. A custom provider sends
Planner and background-job prompts, including document and repository content, to its
`baseUrl`. Configure only endpoints you trust with that data. On a non-loopback
`SERVER_HOST`, Chopin still requires `HARNESS_AUTH=ai-gateway`; a custom provider uses
its own operator key, never a developer's host subscription.

## Implementation

- Loading and validation: `apps/server/src/fork/pi-providers/index.ts`
- MANTL configuration: `apps/server/config/pi-providers.mantl.jsonc`
- Seam: `createPiHarness` in `apps/server/src/harness/harnesses.ts` passes `providers`.
