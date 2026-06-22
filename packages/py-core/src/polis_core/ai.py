"""AI assistant primitives — grounded-RAG models, prompt-injection detector,
confidence scorer, and question keyword extractor (spec §17 / §6.3 / §30.6).

These are pure, dependency-free helpers shared by the FastAPI ``ai-gateway``.
Wire objects are camelCase (``model_dump(by_alias=True)``), mirroring
``@polis/domain``.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field

from polis_core.models import ConfidenceState, ReviewState


class Citation(BaseModel):
    """A pointer from an answer span back into approved evidence (§17)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    index: int
    claim_id: str = Field(alias="claimId")
    source_id: str = Field(alias="sourceId")
    evidence_link_id: str = Field(alias="evidenceLinkId")
    source_title: str | None = Field(default=None, alias="sourceTitle")
    source_url: str | None = Field(default=None, alias="sourceUrl")
    quote: str | None = None


class RetrievalChunk(BaseModel):
    """One retrieved claim + its provenance, ready to synthesize into an answer."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    claim_id: str = Field(alias="claimId")
    text: str
    confidence_state: ConfidenceState = Field(alias="confidenceState")
    evidence_link_id: str = Field(alias="evidenceLinkId")
    source_id: str = Field(alias="sourceId")
    source_title: str = Field(alias="sourceTitle")
    source_type: str = Field(alias="sourceType")
    source_url: str | None = Field(default=None, alias="sourceUrl")


class AssistantAnswer(BaseModel):
    """The wire envelope returned by the gateway for a citizen-assistant ask."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    answer: str
    citations: list[Citation]
    confidence_state: ConfidenceState = Field(alias="confidenceState")
    low_confidence: bool = Field(alias="lowConfidence")
    published: bool
    injection_blocked: bool = Field(alias="injectionBlocked")
    trace_id: str = Field(alias="traceId")
    output_id: str = Field(alias="outputId")
    review_state: ReviewState = Field(alias="reviewState")


class AITrace(BaseModel):
    """Internal trace row mirroring spec §17.5 — never returned to the public edge."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    workflow_type: str = Field(alias="workflowType")
    user_id: str | None = Field(default=None, alias="userId")
    model_provider: str = Field(alias="modelProvider")
    model_name: str = Field(alias="modelName")
    model_version: str | None = Field(default=None, alias="modelVersion")
    prompt_template_id: str = Field(alias="promptTemplateId")
    prompt_template_version: str = Field(alias="promptTemplateVersion")
    retrieval_event_ids: list[str] = Field(alias="retrievalEventIds")
    source_ids: list[str] = Field(alias="sourceIds")
    output_hash: str = Field(alias="outputHash")
    confidence: float
    risk_flags: list[str] = Field(alias="riskFlags")
    human_review_state: str = Field(alias="humanReviewState")
    created_at: str = Field(alias="createdAt")


class InjectionVerdict(BaseModel):
    """Outcome of ``detect_prompt_injection``: detected + matched categories."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    detected: bool
    flags: list[str]


# (category, substring). Detection is deliberately over-broad on injection
# phrases — false positives on genuine questions mentioning e.g. "system prompt"
# are acceptable (safe-side) for v0. Citation-forgery / unauthorized-publish are
# handled at the gateway, not here.
_INJECTION_PATTERNS: list[tuple[str, str]] = [
    ("leaked-system-prompt", "system prompt"),
    ("leaked-system-prompt", "reveal your instructions"),
    ("leaked-system-prompt", "repeat your rules"),
    ("leaked-system-prompt", "show me your prompt"),
    ("leaked-system-prompt", "ignore previous instructions"),
    ("leaked-system-prompt", "ignore all previous"),
    ("leaked-system-prompt", "disregard the above"),
    ("jailbreak", "act as"),
    ("jailbreak", "you are now"),
    ("jailbreak", "pretend you are"),
    ("jailbreak", "new role:"),
    ("jailbreak", "jailbreak"),
    ("jailbreak", "developer mode"),
    ("jailbreak", "do anything now"),
    ("jailbreak", "without restrictions"),
    ("jailbreak", "override your"),
]

_INJECTION_REGEXES: list[tuple[str, re.Pattern[str]]] = [
    (cat, re.compile(pat, re.IGNORECASE)) for cat, pat in _INJECTION_PATTERNS
]


def detect_prompt_injection(text: str) -> InjectionVerdict:
    """Return matched injection categories for ``text``.

    Case-insensitive substring detection over a curated pattern list. Empty or
    whitespace-only text is never flagged.
    """
    if not text or not text.strip():
        return InjectionVerdict(detected=False, flags=[])
    matched: list[str] = []
    for category, regex in _INJECTION_REGEXES:
        if regex.search(text) and category not in matched:
            matched.append(category)
    return InjectionVerdict(detected=bool(matched), flags=matched)


def score_confidence(chunks: list[RetrievalChunk]) -> ConfidenceState:
    """Score the confidence state from retrieved chunks (§17).

    - ``[]`` → ``unsupported_draft``
    - any chunk ``sourceType == 'official'`` → ``official_source``
    - ``len({chunk.sourceId}) >= 2`` → ``multi_source``
    - else → ``single_source``
    """
    if not chunks:
        return ConfidenceState.unsupported_draft
    if any(c.source_type == "official" for c in chunks):
        return ConfidenceState.official_source
    if len({c.source_id for c in chunks}) >= 2:
        return ConfidenceState.multi_source
    return ConfidenceState.single_source


def is_low_confidence(state: ConfidenceState) -> bool:
    """A state is low-confidence iff no approved sources backed the answer."""
    return state == ConfidenceState.unsupported_draft


_STOPWORDS = frozenset(
    {
        "the", "a", "an", "to", "of", "and", "or", "in", "on", "for", "is",
        "are", "what", "how", "do", "does", "i", "you", "your", "me", "my",
        "with", "that", "this", "it", "be", "can", "could", "should", "would",
        "please", "tell", "about",
    }
)


def extract_keywords(question: str) -> list[str]:
    """Lowercase the question, drop stopwords and short tokens, dedupe in order.

    Empty list ⇒ the gateway skips retrieval (no keywords to match).
    """
    tokens = re.split(r"[^a-z0-9]+", question.lower())
    seen: set[str] = set()
    out: list[str] = []
    for tok in tokens:
        if len(tok) < 3 or tok in _STOPWORDS or tok in seen:
            continue
        seen.add(tok)
        out.append(tok)
    return out


__all__ = [
    "AITrace",
    "AssistantAnswer",
    "Citation",
    "InjectionVerdict",
    "RetrievalChunk",
    "detect_prompt_injection",
    "extract_keywords",
    "is_low_confidence",
    "score_confidence",
]

