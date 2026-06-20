# syntax=docker/dockerfile:1
#
# Polis Interface — Python base image.
# Builds the uv workspace (packages/py-core at M0). Python services (AI, data,
# document/ML) extend this image at M3+; it is not wired into compose until then.
FROM python:3.12-slim AS build
ENV UV_PYTHON=3.12 UV_PROJECT_ENVIRONMENT=/app/.venv
RUN pip install --no-cache-dir uv
WORKDIR /app
# Lockfile-driven, reproducible.
COPY uv.lock pyproject.toml ./
COPY packages/py-core packages/py-core
RUN uv sync --frozen

FROM python:3.12-slim AS runner
ENV UV_PYTHON=3.12 PATH=/app/.venv/bin:$PATH
WORKDIR /app
COPY --from=build /app /app
# Smoke entrypoint: confirms polis_core imports.
CMD ["python", "-c", "import polis_core; print('polis-core ready')"]
