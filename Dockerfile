# syntax=docker/dockerfile:1

ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION} AS manifests
WORKDIR /app

COPY package.json bun.lock ./
COPY patches ./patches
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/dialect/package.json ./packages/dialect/package.json
COPY packages/editor/package.json ./packages/editor/package.json
COPY packages/icons/package.json ./packages/icons/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/question/package.json ./packages/question/package.json
COPY packages/viewport/package.json ./packages/viewport/package.json
COPY packages/visuals/package.json ./packages/visuals/package.json

FROM manifests AS build-dependencies
RUN bun install --frozen-lockfile

FROM build-dependencies AS build
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json ./tsconfig.json
RUN bun run build

FROM manifests AS production-dependencies
RUN bun install --frozen-lockfile --production --filter '*'

FROM oven/bun:${BUN_VERSION} AS runtime
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Fork: npx and uvx for stdio Planner extension MCP servers (docs/fork-planner-extensions.md).
COPY --from=node:24.21.0-trixie-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24.21.0-trixie-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=ghcr.io/astral-sh/uv:0.12.22 /uv /uvx /usr/local/bin/
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
	&& ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends python3 \
	&& rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
	PORT=8787 \
	SERVER_HOST=0.0.0.0

COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=bun:bun /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=production-dependencies --chown=bun:bun /app/packages/dialect/node_modules ./packages/dialect/node_modules
COPY --from=production-dependencies --chown=bun:bun /app/packages/question/node_modules ./packages/question/node_modules
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun apps/server ./apps/server
COPY --from=build --chown=bun:bun /app/apps/web/dist ./apps/web/dist
COPY --chown=bun:bun apps/web/package.json ./apps/web/package.json
COPY --chown=bun:bun packages ./packages

USER bun
EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
	CMD ["bun", "-e", "let r=await fetch('http://127.0.0.1:8787/api/session');process.exit(r.ok?0:1)"]

CMD ["sh", "-c", "bun apps/server/src/storage/migrate.ts && exec bun apps/server/src/main.ts"]
