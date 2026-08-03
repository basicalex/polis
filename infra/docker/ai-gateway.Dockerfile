# syntax=docker/dockerfile:1
#
# Polis Interface — AI gateway (Python/FastAPI).
# Multi-stage build: uv-syncs the workspace (polis-core + polis-ai-gateway),
# then copies the venv into a slim runner that also installs the OPA binary
# for runtime policy-as-code evaluation (§17 publish gate).
FROM python:3.12-slim AS build
ENV UV_PYTHON=3.12 UV_PROJECT_ENVIRONMENT=/app/.venv
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY uv.lock pyproject.toml ./
COPY packages/py-core packages/py-core
COPY services/ai-gateway services/ai-gateway
RUN uv sync --frozen --package polis-ai-gateway

FROM python:3.12-slim AS runner
ARG OPA_SHA256
ENV UV_PYTHON=3.12 PATH=/app/.venv/bin:$PATH POLICY_REGO_PATH=/app/policy/ai.rego
RUN test -n "$OPA_SHA256" \
    && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL -o /usr/local/bin/opa \
       https://github.com/open-policy-agent/opa/releases/download/v1.17.1/opa_linux_amd64_static \
    && printf '%s  %s\n' "$OPA_SHA256" /usr/local/bin/opa | sha256sum -c - \
    && chmod 0755 /usr/local/bin/opa \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system polis \
    && useradd --system --gid polis --create-home --home-dir /app --shell /usr/sbin/nologin polis
WORKDIR /app
COPY --from=build --chown=polis:polis /app /app
COPY --chown=polis:polis packages/policy-rules/ai/ai.rego /app/policy/ai.rego
USER polis
EXPOSE 8550
CMD ["python", "-m", "polis_aigateway"]
