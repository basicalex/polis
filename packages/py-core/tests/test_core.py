from __future__ import annotations

import pytest
from polis_core import (
    Claim,
    EvidenceLink,
    Institution,
    ReviewState,
    Visibility,
    sha256_hex,
)
from polis_core.models import ConfidenceState, GovernanceProcess

# Known SHA-256("abc")
SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_sha256_hex_known_digest():
    assert sha256_hex(b"abc") == SHA256_ABC


def test_sha256_hex_rejects_non_bytes():
    with pytest.raises(TypeError):
        sha256_hex("abc")  # type: ignore[arg-type]


def test_claim_round_trip():
    claim = Claim(
        id="c1",
        text="The office routes complaints.",
        claimType="role_responsibility",
        subjectType="institution",
        subjectId="inst-1",
        evidence=[
            EvidenceLink(
                id="ev1", sourceId="src1", confidence=0.8, retrievedAt="2026-01-01T00:00:00Z"
            )
        ],
        confidence=0.8,
        reviewState="approved",
        createdBy="dev-seed",
        createdAt="2026-01-01T00:00:00Z",
        methodVersion="evidence-v1",
    )
    dumped = claim.model_dump(by_alias=True)
    restored = Claim.model_validate(dumped)
    assert restored == claim
    # camelCase wire keys are preserved on dump
    assert "reviewState" in dumped
    assert "claimType" in dumped


def test_enums_exact_values():
    assert {e.value for e in ReviewState} == {
        "draft",
        "submitted",
        "needs_revision",
        "under_review",
        "approved",
        "contested",
        "deprecated",
        "rejected",
        "archived",
    }
    assert {e.value for e in Visibility} == {
        "public",
        "private",
        "restricted",
        "redacted",
        "sealed",
        "internal",
    }
    assert ConfidenceState.unsupported_draft.value == "unsupported_draft"


def test_institution_and_process_wire_shapes():
    inst = Institution(
        id="i",
        name="Office",
        jurisdiction="HR/local-demo",
        description="x",
        confidenceState="official_source",
        reviewState="approved",
        evidence=[],
    )
    assert inst.model_dump(by_alias=True)["confidenceState"] == "official_source"

    proc = GovernanceProcess(
        id="p",
        name="Complaint",
        need="Traceable complaint path.",
        legalBasis="charter",
        steps=["a", "b"],
        documentTypes=["id"],
        failureModes=[],
        simplificationCandidates=[],
        reviewState="approved",
    )
    assert proc.model_dump(by_alias=True)["legalBasis"] == "charter"
