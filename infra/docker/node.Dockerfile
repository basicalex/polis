# syntax=docker/dockerfile:1
#
# Polis Interface — Bun service image (parametric).
# Build arg SERVICE selects which workspace service is built and run. Defaults to
# platform-api (the public BFF edge). One image per service; compose passes the arg.
FROM oven/bun:1.3.14-debian AS build
ENV CI=1
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
# Keep dependency work SERVICE-independent so BuildKit shares it across images.
RUN bun run --filter @polis/domain build \
  && bun run --filter @polis/db build \
  && bun run --filter @polis/service-runtime build
ARG SERVICE=platform-api
RUN bun run --filter @polis/${SERVICE} build

FROM oven/bun:1.3.14-debian AS runner
ENV DEBIAN_FRONTEND=noninteractive
# Share one package layer across service images and retry transient mirror failures.
RUN apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ARG SERVICE=platform-api
# Promote the build arg to a runtime env var so the CMD can resolve it.
ENV NODE_ENV=production SERVICE=${SERVICE}
WORKDIR /app
COPY --from=build --chown=bun:bun /app /app
EXPOSE 8080
USER bun
CMD ["sh", "-c", "exec bun services/${SERVICE}/dist/index.js"]
