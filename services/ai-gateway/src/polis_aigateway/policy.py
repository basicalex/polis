"""OPA-backed publish gate (spec §17 / ADR-005 / §30.6).

Shells out to ``opa eval`` at runtime — real policy-as-code, not a mirror.
Fails **closed** (returns ``False``) when ``opa`` is unavailable or the output
cannot be parsed. A publish gate never defaults to allow.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

POLICY_REGO_PATH = os.environ.get("POLICY_REGO_PATH", "packages/policy-rules/ai/ai.rego")


def publish_allowed(
    *,
    has_citations: bool,
    has_approved_sources: bool,
    injection_detected: bool,
    review_state: str,
) -> bool:
    """Evaluate ``data.polis.ai.publish`` against the four-condition gate."""
    opa_input = {
        "has_citations": has_citations,
        "has_approved_sources": has_approved_sources,
        "injection_detected": injection_detected,
        "review_state": review_state,
    }
    query = f"data.polis.ai.publish with input as {json.dumps(opa_input)}"
    try:
        proc = subprocess.run(
            ["opa", "eval", "-f", "json", "-d", POLICY_REGO_PATH, query],
            capture_output=True,
            check=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        print(f"[policy] opa eval failed, failing closed: {exc}", file=sys.stderr)
        return False
    try:
        parsed = json.loads(proc.stdout)
        return bool(parsed["result"][0]["expressions"][0]["value"])
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        print(f"[policy] opa output parse failed, failing closed: {exc}", file=sys.stderr)
        return False
