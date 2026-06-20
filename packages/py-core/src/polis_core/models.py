"""Pydantic v2 models mirroring ``@polis/domain`` wire types.

Enum value sets match the canonical contract exactly (see spec §12.2, §11).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ReviewState(StrEnum):
    draft = "draft"
    submitted = "submitted"
    needs_revision = "needs_revision"
    under_review = "under_review"
    approved = "approved"
    contested = "contested"
    deprecated = "deprecated"
    rejected = "rejected"
    archived = "archived"


class Visibility(StrEnum):
    public = "public"
    private = "private"
    restricted = "restricted"
    redacted = "redacted"
    sealed = "sealed"
    internal = "internal"


class ConfidenceState(StrEnum):
    unsupported_draft = "unsupported_draft"
    single_source = "single_source"
    multi_source = "multi_source"
    official_source = "official_source"
    official_confirmed = "official_confirmed"
    expert_reviewed = "expert_reviewed"
    contested = "contested"
    outdated = "outdated"
    superseded = "superseded"


class ClaimType(StrEnum):
    legal_mandate = "legal_mandate"
    budget_amount = "budget_amount"
    role_responsibility = "role_responsibility"
    process_step = "process_step"
    document_requirement = "document_requirement"
    risk_assessment = "risk_assessment"
    proposal_assertion = "proposal_assertion"
    public_statement = "public_statement"
    other = "other"


class EvidenceLink(BaseModel):
    """A pointer from a claim into a source (spec §12.2 EvidenceLink)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    source_id: str = Field(alias="sourceId")
    locator: dict[str, Any] | None = None
    quote: str | None = None
    paraphrase: str | None = None
    source_hash: str | None = Field(default=None, alias="sourceHash")
    retrieved_at: str | None = Field(default=None, alias="retrievedAt")
    confidence: float


class Claim(BaseModel):
    """A falsifiable, sourced assertion (spec §12.2 Claim)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    text: str
    claim_type: ClaimType = Field(alias="claimType")
    subject_type: str = Field(alias="subjectType")
    subject_id: str = Field(alias="subjectId")
    evidence: list[EvidenceLink]
    confidence: float
    review_state: ReviewState = Field(alias="reviewState")
    created_by: str = Field(alias="createdBy")
    created_at: str = Field(alias="createdAt")
    method_version: str | None = Field(default=None, alias="methodVersion")
    ai_trace_id: str | None = Field(default=None, alias="aiTraceId")


class Institution(BaseModel):
    """A public body within a jurisdiction (spec §11.2)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    name: str
    jurisdiction: str
    description: str
    confidence_state: ConfidenceState = Field(alias="confidenceState")
    review_state: ReviewState = Field(alias="reviewState")
    evidence: list[EvidenceLink]


class GovernanceProcess(BaseModel):
    """A recurring administrative process (spec §11.4)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    name: str
    need: str
    legal_basis: str = Field(alias="legalBasis")
    steps: list[str]
    document_types: list[str] = Field(alias="documentTypes")
    failure_modes: list[str] = Field(alias="failureModes")
    simplification_candidates: list[str] = Field(alias="simplificationCandidates")
    review_state: ReviewState = Field(alias="reviewState")
