"""FastAPI app — grounded-RAG assistant routes (spec §6.3 / §17 / §30.6).

All handlers are sync ``def`` so FastAPI runs them in a threadpool, making
synchronous psycopg safe. Each request gets a fresh ``request_id`` /
``trace_id`` / ``output_id`` (UUID4). Prompt and output hashes use
``polis_core.sha256_hex``.
"""

from __future__ import annotations

import sys
import uuid
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from polis_core import (
    AssistantAnswer,
    Citation,
    ConfidenceState,
    ReviewState,
    detect_prompt_injection,
    is_low_confidence,
    score_confidence,
    sha256_hex,
)
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field

from polis_aigateway.audit import emit_audit
from polis_aigateway.db import get_conn
from polis_aigateway.policy import publish_allowed
from polis_aigateway.rag import APPROVED_SOURCE_TYPES, retrieve

app = FastAPI(title="polis-ai-gateway", version="0.1.0")

_MODEL_PROVIDER = "polis"
_MODEL_NAME = "stub"
_PROMPT_TEMPLATE_ID = "citizen-assistant-v1"
_PROMPT_TEMPLATE_VERSION = "0.1"
_INJECTION_REFUSAL = "I can't act on that request."
_NO_RESULTS = "No approved public sources were found for this question."
_RESULTS_PREFIX = "Based on approved public sources: "


# ---------------------------------------------------------------------------
# Request bodies (extra="ignore" so clients cannot inject published/reviewState)
# ---------------------------------------------------------------------------


class AskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    question: str | None = None
    workflow_type: str | None = Field(default=None, alias="workflowType")
    user_id: str | None = Field(default=None, alias="userId")


class ReviewRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    decision: str | None = None
    reviewer_id: str | None = Field(default=None, alias="reviewerId")
    note: str | None = None


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------


def _persist_trace(
    conn: Connection,
    *,
    trace_id: str,
    request_id: str,
    workflow_type: str,
    user_id: str | None,
    prompt_hash: str,
    source_ids: list[str],
    claim_ids: list[str],
    risk_flags: list[str],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ai_traces
              (id, request_id, workflow_type, user_id, prompt_hash,
               model_provider, model_name, model_version,
               prompt_template_id, prompt_template_version,
               retrieved_source_ids, retrieved_claim_ids, risk_flags)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s)
            """,
            (
                trace_id, request_id, workflow_type, user_id, prompt_hash,
                _MODEL_PROVIDER, _MODEL_NAME,
                _PROMPT_TEMPLATE_ID, _PROMPT_TEMPLATE_VERSION,
                Json(source_ids), Json(claim_ids), Json(risk_flags),
            ),
        )


def _persist_output(
    conn: Connection,
    *,
    output_id: str,
    trace_id: str,
    answer: str,
    citations: list[Citation],
    confidence_state: ConfidenceState,
    review_state: ReviewState,
    published: bool,
    output_hash: str,
) -> None:
    wire_citations = [c.model_dump(by_alias=True) for c in citations]
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ai_outputs
              (id, trace_id, answer, citations, confidence,
               confidence_state, review_state, published, output_hash, model, params)
            VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, NULL)
            """,
            (
                output_id, trace_id, answer, Json(wire_citations),
                confidence_state.value, review_state.value, published,
                output_hash, _MODEL_NAME,
            ),
        )


def _persist_review_queue(
    conn: Connection,
    *,
    output_id: str,
    status: str,
    reviewer_id: str | None = None,
    note: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ai_review_queue (id, output_id, status, reviewer_id, note, decided_at)
            VALUES (%s, %s, %s, %s, %s,
                    CASE WHEN %s IN ('approved','rejected') THEN now() ELSE NULL END)
            """,
            (str(uuid.uuid4()), output_id, status, reviewer_id, note, status),
        )


# ---------------------------------------------------------------------------
# Effective-state derivation (mirrors proof_supersessions latest-row-wins)
# ---------------------------------------------------------------------------


def _effective_state(row: dict[str, Any]) -> tuple[str, bool]:
    """Return (effectiveReviewState, effectivePublished) for an output row."""
    published: bool = row["published"]
    review_state: str = row["review_state"]
    latest_decided: str | None = row.get("latest_decided_status")
    if latest_decided:
        return latest_decided, published or latest_decided == "approved"
    return review_state, published


def _output_view(conn: Connection, row: dict[str, Any]) -> dict[str, Any]:
    eff_review, eff_pub = _effective_state(row)
    created = row.get("created_at")
    return {
        "outputId": row["id"],
        "traceId": row["trace_id"],
        "answer": row["answer"],
        "citations": row["citations"],
        "confidenceState": row["confidence_state"],
        "reviewState": row["review_state"],
        "published": row["published"],
        "effectiveReviewState": eff_review,
        "effectivePublished": eff_pub,
        "outputHash": row["output_hash"],
        "model": row["model"],
        "createdAt": created.isoformat() if created else None,
    }


_OUTPUT_WITH_EFFECTIVE_SQL = """
SELECT o.*,
  (SELECT q.status FROM ai_review_queue q
   WHERE q.output_id = o.id AND q.status IN ('approved','rejected')
   ORDER BY q.created_at DESC LIMIT 1) AS latest_decided_status
FROM ai_outputs o
"""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/version")
def version() -> dict[str, str]:
    return {"service": "ai-gateway", "version": "0.1.0"}


@app.post("/internal/ai/answer")
def answer(req: AskRequest):
    if not req.question:
        return JSONResponse(status_code=400, content={"error": "missing_question"})

    question = req.question
    request_id = str(uuid.uuid4())
    trace_id = str(uuid.uuid4())
    output_id = str(uuid.uuid4())
    prompt_hash = sha256_hex(question.encode())
    workflow_type = req.workflow_type or "citizen-assistant"

    verdict = detect_prompt_injection(question)

    # ---- Injection short-circuit: refuse, persist best-effort, return. ----
    if verdict.detected:
        answer_text = _INJECTION_REFUSAL
        confidence_state = ConfidenceState.unsupported_draft
        review_state = ReviewState.draft
        output_hash = sha256_hex(answer_text.encode())
        try:
            with get_conn() as conn:
                _persist_trace(
                    conn, trace_id=trace_id, request_id=request_id,
                    workflow_type=workflow_type, user_id=req.user_id,
                    prompt_hash=prompt_hash, source_ids=[], claim_ids=[],
                    risk_flags=verdict.flags,
                )
                _persist_output(
                    conn, output_id=output_id, trace_id=trace_id,
                    answer=answer_text, citations=[],
                    confidence_state=confidence_state,
                    review_state=review_state, published=False,
                    output_hash=output_hash,
                )
            emit_audit(
                event_type="ai.answer.requested", action="answer",
                target={"type": "ai-trace", "id": trace_id},
                data={
                    "question_hash": prompt_hash, "retrieved_count": 0,
                    "injection_blocked": True, "published": False,
                    "confidence_state": confidence_state.value,
                },
            )
        except Exception as exc:  # noqa: BLE001 — best-effort
            print(
                f"[ai-gateway] injection persistence/audit failed (best-effort): {exc}",
                file=sys.stderr,
            )
        return AssistantAnswer(
            answer=answer_text, citations=[],
            confidence_state=confidence_state, low_confidence=True,
            published=False, injection_blocked=True,
            trace_id=trace_id, output_id=output_id, review_state=review_state,
        )

    # ---- Normal path: retrieve → synthesize → decide publish. ----
    try:
        with get_conn() as conn:
            chunks = retrieve(conn, question)
    except Exception as exc:  # noqa: BLE001 — DB unavailable
        print(f"[ai-gateway] retrieve failed: {exc}", file=sys.stderr)
        return JSONResponse(status_code=503, content={"error": "db_unavailable"})

    if chunks:
        answer_text = _RESULTS_PREFIX + "; ".join(
            f"{c.text} [{i + 1}]" for i, c in enumerate(chunks)
        )
    else:
        answer_text = _NO_RESULTS

    # Citations built ONLY from chunks — never reads the question for source ids
    # (citation-forgery defense).
    citations = [
        Citation(
            index=i + 1, claimId=c.claim_id, sourceId=c.source_id,
            evidenceLinkId=c.evidence_link_id, sourceTitle=c.source_title,
            sourceUrl=c.source_url, quote=c.text,
        )
        for i, c in enumerate(chunks)
    ]
    confidence_state = score_confidence(chunks)
    low_confidence = is_low_confidence(confidence_state)
    output_hash = sha256_hex(answer_text.encode())
    source_ids = list({c.source_id for c in chunks})
    claim_ids = list({c.claim_id for c in chunks})
    has_approved_sources = any(
        c.source_type in APPROVED_SOURCE_TYPES for c in chunks
    )

    grounded = bool(chunks) and has_approved_sources and not low_confidence
    if grounded:
        creation_review_state = ReviewState.approved
        published = publish_allowed(
            has_citations=len(citations) > 0,
            has_approved_sources=has_approved_sources,
            injection_detected=False,
            review_state="approved",
        )
        review_queue_status = "pending" if not published else None
    else:
        creation_review_state = ReviewState.under_review
        published = False
        review_queue_status = "pending"

    try:
        with get_conn() as conn:
            _persist_trace(
                conn, trace_id=trace_id, request_id=request_id,
                workflow_type=workflow_type, user_id=req.user_id,
                prompt_hash=prompt_hash, source_ids=source_ids,
                claim_ids=claim_ids, risk_flags=[],
            )
            _persist_output(
                conn, output_id=output_id, trace_id=trace_id,
                answer=answer_text, citations=citations,
                confidence_state=confidence_state,
                review_state=creation_review_state, published=published,
                output_hash=output_hash,
            )
            if review_queue_status:
                _persist_review_queue(
                    conn, output_id=output_id, status=review_queue_status,
                )
        if published:
            emit_audit(
                event_type="ai.output.published", action="publish",
                target={"type": "ai-output", "id": output_id},
                data={"trace_id": trace_id, "output_hash": output_hash},
            )
        emit_audit(
            event_type="ai.answer.requested", action="answer",
            target={"type": "ai-trace", "id": trace_id},
            data={
                "question_hash": prompt_hash, "retrieved_count": len(chunks),
                "injection_blocked": False, "published": published,
                "confidence_state": confidence_state.value,
            },
        )
    except Exception as exc:  # noqa: BLE001 — best-effort persistence
        print(f"[ai-gateway] persistence failed: {exc}", file=sys.stderr)

    return AssistantAnswer(
        answer=answer_text, citations=citations,
        confidence_state=confidence_state, low_confidence=low_confidence,
        published=published, injection_blocked=False,
        trace_id=trace_id, output_id=output_id,
        review_state=creation_review_state,
    )


@app.get("/internal/ai/traces")
def list_traces():
    try:
        with get_conn() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    "SELECT * FROM ai_traces ORDER BY created_at DESC LIMIT 50"
                )
                traces = cur.fetchall()
            items = []
            for t in traces:
                with conn.cursor(row_factory=dict_row) as cur:
                    cur.execute(
                        _OUTPUT_WITH_EFFECTIVE_SQL
                        + " WHERE o.trace_id = %s ORDER BY o.created_at DESC",
                        (t["id"],),
                    )
                    outputs = [_output_view(conn, o) for o in cur.fetchall()]
                created = t.get("created_at")
                items.append({
                    "traceId": t["id"],
                    "requestId": t["request_id"],
                    "workflowType": t["workflow_type"],
                    "userId": t["user_id"],
                    "promptHash": t["prompt_hash"],
                    "modelName": t["model_name"],
                    "riskFlags": t["risk_flags"],
                    "createdAt": created.isoformat() if created else None,
                    "outputs": outputs,
                })
        return {"items": items}
    except Exception as exc:  # noqa: BLE001 — DB unavailable
        print(f"[ai-gateway] list_traces failed: {exc}", file=sys.stderr)
        return JSONResponse(status_code=503, content={"error": "db_unavailable"})


@app.get("/internal/ai/traces/{trace_id}")
def get_trace(trace_id: str):
    try:
        with get_conn() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    "SELECT * FROM ai_traces WHERE id = %s", (trace_id,)
                )
                t = cur.fetchone()
            if not t:
                return JSONResponse(
                    status_code=404, content={"error": "not_found", "id": trace_id}
                )
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    _OUTPUT_WITH_EFFECTIVE_SQL
                    + " WHERE o.trace_id = %s ORDER BY o.created_at DESC",
                    (trace_id,),
                )
                outputs = [_output_view(conn, o) for o in cur.fetchall()]
            created = t.get("created_at")
            return {
                "traceId": t["id"],
                "requestId": t["request_id"],
                "workflowType": t["workflow_type"],
                "userId": t["user_id"],
                "promptHash": t["prompt_hash"],
                "modelName": t["model_name"],
                "riskFlags": t["risk_flags"],
                "createdAt": created.isoformat() if created else None,
                "outputs": outputs,
            }
    except Exception as exc:  # noqa: BLE001 — DB unavailable
        print(f"[ai-gateway] get_trace failed: {exc}", file=sys.stderr)
        return JSONResponse(status_code=503, content={"error": "db_unavailable"})


@app.get("/internal/ai/outputs/{output_id}")
def get_output(output_id: str):
    try:
        with get_conn() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    _OUTPUT_WITH_EFFECTIVE_SQL + " WHERE o.id = %s",
                    (output_id,),
                )
                row = cur.fetchone()
            if not row:
                return JSONResponse(
                    status_code=404, content={"error": "not_found", "id": output_id}
                )
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    "SELECT * FROM ai_review_queue WHERE output_id = %s"
                    " ORDER BY created_at DESC",
                    (output_id,),
                )
                history = cur.fetchall()
            view = _output_view(conn, row)
            view["reviewHistory"] = [
                {
                    "id": h["id"],
                    "status": h["status"],
                    "reviewerId": h["reviewer_id"],
                    "note": h["note"],
                    "decidedAt": h["decided_at"].isoformat() if h["decided_at"] else None,
                    "createdAt": h["created_at"].isoformat()
                    if h["created_at"] else None,
                }
                for h in history
            ]
            return view
    except Exception as exc:  # noqa: BLE001 — DB unavailable
        print(f"[ai-gateway] get_output failed: {exc}", file=sys.stderr)
        return JSONResponse(status_code=503, content={"error": "db_unavailable"})


@app.post("/internal/ai/outputs/{output_id}/review")
def review_output(output_id: str, req: ReviewRequest):
    if req.decision not in ("approved", "rejected"):
        return JSONResponse(
            status_code=400, content={"error": "invalid_decision"}
        )
    try:
        with get_conn() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    "SELECT id FROM ai_outputs WHERE id = %s", (output_id,)
                )
                if not cur.fetchone():
                    return JSONResponse(
                        status_code=404,
                        content={"error": "not_found", "id": output_id},
                    )
            _persist_review_queue(
                conn, output_id=output_id, status=req.decision,
                reviewer_id=req.reviewer_id, note=req.note,
            )
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    _OUTPUT_WITH_EFFECTIVE_SQL + " WHERE o.id = %s",
                    (output_id,),
                )
                row = cur.fetchone()
            eff_review, eff_pub = _effective_state(row)
        emit_audit(
            event_type=(
                "ai.output.published" if req.decision == "approved"
                else "ai.output.rejected"
            ),
            action="review",
            target={"type": "ai-output", "id": output_id},
            data={
                "decision": req.decision, "reviewer_id": req.reviewer_id,
                "effective_review_state": eff_review,
                "effective_published": eff_pub,
            },
        )
        return JSONResponse(
            status_code=201,
            content={
                "outputId": output_id,
                "effectiveReviewState": eff_review,
                "effectivePublished": eff_pub,
            },
        )
    except Exception as exc:  # noqa: BLE001 — DB unavailable
        print(f"[ai-gateway] review_output failed: {exc}", file=sys.stderr)
        return JSONResponse(status_code=503, content={"error": "db_unavailable"})
