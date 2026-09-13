# syntax=docker/dockerfile:1

ARG SERVICE=platform-api

FROM oven/bun:1.3.14 AS build
ARG SERVICE
ARG OPA_SHA256=3d4bb88482958d990351ec5d2f7558509992776bc473bc1b78d86d76cb993ca3
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL -o /usr/local/bin/opa \
       https://github.com/open-policy-agent/opa/releases/download/v1.17.1/opa_linux_amd64_static \
    && printf '%s  %s\n' "$OPA_SHA256" /usr/local/bin/opa | sha256sum -c - \
    && chmod 0755 /usr/local/bin/opa \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN bun install --frozen-lockfile
RUN case "$SERVICE" in \
      trace-service|platform-api|citizen-identity-service) ;; \
      *) echo "SERVICE must be trace-service, platform-api, or citizen-identity-service" >&2; exit 64 ;; \
    esac \
    && bun run --filter @polis/domain build \
    && bun run --filter @polis/db build \
    && bun run --filter @polis/service-runtime build \
    && bun run --filter @polis/policy-rules build \
    && bun run --filter "@polis/${SERVICE}" build \
    && printf '%s\n' "$SERVICE" > /tmp/polis-service

FROM oven/bun:1.3.14 AS production-deps
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production

FROM node:22-bookworm-slim AS runtime
ARG SERVICE
RUN groupadd --system --gid 10001 polis \
    && useradd --system --uid 10001 --gid polis --no-create-home --shell /usr/sbin/nologin polis
WORKDIR /app
COPY --from=production-deps --chown=polis:polis /app/node_modules ./node_modules
COPY --from=production-deps --chown=polis:polis /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=production-deps --chown=polis:polis /app/services/${SERVICE}/node_modules ./services/${SERVICE}/node_modules
COPY --from=build --chown=polis:polis /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build --chown=polis:polis /app/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=polis:polis /app/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=polis:polis /app/packages/db/dist ./packages/db/dist
COPY --from=build --chown=polis:polis /app/packages/db/migrations ./packages/db/migrations
COPY --from=build --chown=polis:polis /app/packages/service-runtime/package.json ./packages/service-runtime/package.json
COPY --from=build --chown=polis:polis /app/packages/service-runtime/dist ./packages/service-runtime/dist
COPY --from=build --chown=polis:polis /app/services/${SERVICE}/package.json ./services/${SERVICE}/package.json
COPY --from=build --chown=polis:polis /app/services/${SERVICE}/dist ./services/${SERVICE}/dist
COPY --from=build --chown=polis:polis /app/services/trace-service/migrations ./services/trace-service/migrations
COPY --from=build --chown=polis:polis /app/config/pilots/vrsar-orsera.json ./config/pilots/vrsar-orsera.json
COPY --from=build --chown=polis:polis /tmp/polis-service ./deploy/railway/service
COPY --chown=polis:polis --chmod=0555 deploy/railway/start.sh ./deploy/railway/start.sh
USER polis
CMD ["/app/deploy/railway/start.sh"]
