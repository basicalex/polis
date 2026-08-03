"""Entrypoint: ``python -m polis_aigateway`` → uvicorn on PORT (default 8550)."""

from __future__ import annotations

import os

import uvicorn

from polis_aigateway.main import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8550")),
        timeout_keep_alive=5,
        timeout_graceful_shutdown=10,
    )
