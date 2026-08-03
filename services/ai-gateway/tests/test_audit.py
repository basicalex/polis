"""Tests for best-effort authenticated audit emission."""

from __future__ import annotations

import json
import urllib.error

from polis_aigateway import audit


def _event() -> dict:
    return {
        "event_type": "ai.answer.requested",
        "action": "answer",
        "target": {"type": "ai-trace", "id": "trace-1"},
        "data": {"published": False},
        "correlation_id": "request-1",
    }




class _AuditResponse:
    def __init__(self, captured):
        self.captured = captured

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.captured["closed"] = True
        return False

    def read(self):
        self.captured["read"] = True
        return b""

def test_emit_audit_sends_internal_token(monkeypatch):
    captured = {}
    monkeypatch.setenv("AUDIT_INTERNAL_URL", "http://audit.test:8600")
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-internal-token")

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return _AuditResponse(captured)

    monkeypatch.setattr(audit.urllib.request, "urlopen", fake_urlopen)

    audit.emit_audit(**_event())

    request = captured["request"]
    headers = {key.lower(): value for key, value in request.header_items()}
    assert request.full_url == "http://audit.test:8600/internal/audit/events"
    assert headers["x-polis-internal-token"] == "test-internal-token"
    assert json.loads(request.data) == {
        "eventType": "ai.answer.requested",
        "action": "answer",
        "visibility": "public",
        "actor": {"type": "service", "id": "ai-gateway"},
        "target": {"type": "ai-trace", "id": "trace-1"},
        "data": {"published": False},
        "correlationId": "request-1",
    }
    assert captured["timeout"] == audit._AUDIT_HTTP_TIMEOUT_SECONDS
    assert captured["read"] is True
    assert captured["closed"] is True


def test_emit_audit_without_token_fails_closed(monkeypatch, capsys):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)

    def unexpected_urlopen(*_args, **_kwargs):
        raise AssertionError("audit request must not be sent without a token")

    monkeypatch.setattr(audit.urllib.request, "urlopen", unexpected_urlopen)

    audit.emit_audit(**_event())

    assert capsys.readouterr().err == (
        "[audit] emit failed: INTERNAL_API_TOKEN is not configured\n"
    )


def test_emit_audit_network_failure_remains_best_effort(monkeypatch, capsys):
    token = "secret-never-log"
    monkeypatch.setenv("INTERNAL_API_TOKEN", token)

    def failing_urlopen(*_args, **_kwargs):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr(audit.urllib.request, "urlopen", failing_urlopen)

    audit.emit_audit(**_event())

    error = capsys.readouterr().err
    assert "emit failed" in error
    assert "offline" in error
    assert token not in error
