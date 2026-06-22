"""Best-effort audit emit — mirrors proof-service ``emitAudit`` (§26.3).

Uses ``urllib.request`` (stdlib) so the gateway has no HTTP client dependency.
Never raises: failures are logged to stderr.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

_ACTOR: dict[str, str] = {"type": "service", "id": "ai-gateway"}


def emit_audit(
    *,
    event_type: str,
    action: str,
    target: dict[str, str],
    data: dict[str, Any],
    correlation_id: str | None = None,
) -> None:
    """POST an audit event to ``AUDIT_INTERNAL_URL/internal/audit/events``.

    Target keys are chosen so the existing BFF
    ``GET /api/v1/audit/:objectType/:objectId`` surfaces them:
      - ``ai.answer.requested`` → ``target:{type:'ai-trace', id:traceId}``
    """
    base = os.environ.get("AUDIT_INTERNAL_URL", "http://localhost:8600")
    body = {
        "eventType": event_type,
        "action": action,
        "visibility": "public",
        "actor": _ACTOR,
        "target": target,
        "data": data,
        "correlationId": correlation_id,
    }
    try:
        req = urllib.request.Request(
            base + "/internal/audit/events",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)  # noqa: S310 — internal URL
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        print(f"[audit] emit failed: {exc}", file=sys.stderr)
