# syntax=docker/dockerfile:1
#
# Polis Interface — Node service image (parametric).
# Build arg SERVICE selects which workspace service is built and run. Defaults to
# platform-api (the public BFF edge). One image per service; compose passes the arg.
FROM node:24-slim AS build
ENV CI=1
ARG SERVICE=platform-api
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Build the selected service and all its workspace dependencies (the `...` selector).
RUN pnpm --filter @polis/${SERVICE}... build

FROM node:24-slim AS runner
ARG SERVICE=platform-api
# Promote the build arg to a runtime env var so the CMD can resolve it.
ENV NODE_ENV=production SERVICE=${SERVICE}
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8080
CMD ["sh", "-c", "exec node services/${SERVICE}/dist/index.js"]
