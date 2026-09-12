# SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import json
import unicodedata
from typing import Any

from polis_core import IntakeDraft, IntakeKnownCase, extract_keywords

from polis_aigateway.pilot import PilotCatalogue

INTAKE_WORKFLOW_TYPE = "case-intake"
INTAKE_PROMPT_TEMPLATE_ID = "case-intake-v1"
INTAKE_PROMPT_TEMPLATE_VERSION = "0.1"
MAX_INTAKE_TEXT_CHARS = 8000
MAX_KNOWN_CASES = 50
UNCLASSIFIED = "unclassified"

_DRAFT_RISK_FLAGS = frozenset(
    {
        "location-missing",
        "low-confidence",
        "office-routing-inferred",
        "possible-duplicate",
    }
)


def _fold(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(char for char in normalized if not unicodedata.combining(char)).casefold()


def propose_category(text: str, catalogue: PilotCatalogue) -> tuple[str, float]:
    folded_text = _fold(text)
    best_category = UNCLASSIFIED
    best_hits = 0
    for category_id in catalogue.category_ids:
        hits = {
            _fold(keyword)
            for keyword in catalogue.category_keywords.get(category_id, ())
            if _fold(keyword) in folded_text
        }
        if len(hits) > best_hits:
            best_category = category_id
            best_hits = len(hits)

    if best_hits >= 2:
        return best_category, 0.8
    if best_hits == 1:
        return best_category, 0.6
    return UNCLASSIFIED, 0.1


def propose_location(text: str, catalogue: PilotCatalogue) -> tuple[str, list[str]]:
    folded_text = _fold(text)
    for settlement in catalogue.settlements:
        if _fold(settlement) in folded_text:
            return settlement, []

    for line in text.splitlines():
        candidate = line.strip()
        if candidate and len(candidate) <= 120 and any(char.isdigit() for char in candidate):
            return candidate, []
    return "", ["location-missing"]


def propose_duplicate(
    text: str,
    category: str,
    known_open_cases: list[IntakeKnownCase],
) -> tuple[str | None, list[str]]:
    report_keywords = set(extract_keywords(text))
    if not report_keywords:
        return None, []

    best_case_id: str | None = None
    best_score = 0.0
    for known_case in known_open_cases:
        if known_case.category != category:
            continue
        known_keywords = set(
            extract_keywords(f"{known_case.summary} {known_case.location_text}")
        )
        union = report_keywords | known_keywords
        score = len(report_keywords & known_keywords) / len(union) if union else 0.0
        if score >= 0.5 and score > best_score:
            best_case_id = known_case.case_id
            best_score = score

    if best_case_id is None:
        return None, []
    return best_case_id, ["possible-duplicate"]


def propose_office(catalogue: PilotCatalogue) -> tuple[str, list[str]]:
    flags = (
        ["office-routing-inferred"]
        if catalogue.office_routing_status == "inferred-test-only"
        else []
    )
    return catalogue.office_id, flags


def propose_from_rules(
    text: str,
    language: str,
    catalogue: PilotCatalogue,
    known_open_cases: list[IntakeKnownCase],
) -> IntakeDraft:
    del language
    category, confidence = propose_category(text, catalogue)
    location_text, location_flags = propose_location(text, catalogue)
    duplicate_of, duplicate_flags = propose_duplicate(text, category, known_open_cases)
    office, office_flags = propose_office(catalogue)
    risk_flags = [
        *(["low-confidence"] if category == UNCLASSIFIED else []),
        *location_flags,
        *duplicate_flags,
        *office_flags,
    ]
    return IntakeDraft(
        category=category,
        locationText=location_text,
        geo=None,
        duplicateOf=duplicate_of,
        office=office,
        confidence=confidence,
        riskFlags=list(dict.fromkeys(risk_flags)),
    )


def build_intake_messages(
    text: str,
    language: str,
    catalogue: PilotCatalogue,
    known_open_cases: list[IntakeKnownCase],
) -> list[dict[str, str]]:
    allowed_categories = [*catalogue.category_ids, UNCLASSIFIED]
    known_cases = [case.model_dump(by_alias=True) for case in known_open_cases]
    schema = {
        "category": allowed_categories,
        "locationText": "string",
        "geo": None,
        "duplicateOf": "caseId or null",
        "office": catalogue.office_id,
        "confidence": "number from 0 to 1",
        "riskFlags": sorted(_DRAFT_RISK_FLAGS),
    }
    return [
        {
            "role": "system",
            "content": (
                "Propose structured civic case-intake fields for official review. "
                "Return only one strict JSON object matching the supplied schema. "
                "Never publish, geocode, invent a category, invent an office, or claim "
                "that a duplicate is certain. Use only supplied known case IDs."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Language: {language}\n"
                f"Allowed schema and values: {json.dumps(schema, ensure_ascii=False)}\n"
                f"Known open cases: {json.dumps(known_cases, ensure_ascii=False)}\n"
                f"Civic report:\n{text}"
            ),
        },
    ]


def _fallback_draft(
    catalogue: PilotCatalogue,
    text: str,
    language: str,
    known_open_cases: list[IntakeKnownCase],
) -> IntakeDraft:
    draft = propose_from_rules(text, language, catalogue, known_open_cases)
    return draft.model_copy(
        update={
            "risk_flags": list(
                dict.fromkeys([*draft.risk_flags, "provider-parse-failed"])
            )
        }
    )


def parse_draft(
    raw_json: str,
    catalogue: PilotCatalogue,
    *,
    text: str = "",
    language: str | None = None,
    known_open_cases: list[IntakeKnownCase] | None = None,
) -> IntakeDraft:
    cases = known_open_cases or []
    try:
        parsed: Any = json.loads(raw_json)
        draft = IntakeDraft.model_validate(parsed)
        known_case_ids = {
            case.case_id for case in cases if case.category == draft.category
        }
        if (
            draft.category not in {*catalogue.category_ids, UNCLASSIFIED}
            or draft.office != catalogue.office_id
            or draft.geo is not None
            or not 0.0 <= draft.confidence <= 1.0
            or any(flag not in _DRAFT_RISK_FLAGS for flag in draft.risk_flags)
            or (draft.duplicate_of is not None and draft.duplicate_of not in known_case_ids)
        ):
            raise ValueError("provider returned values outside the pilot catalogue")
        flags = [
            *draft.risk_flags,
            *(
                ["low-confidence"]
                if draft.category == UNCLASSIFIED
                else []
            ),
            *(["location-missing"] if not draft.location_text else []),
            *(["possible-duplicate"] if draft.duplicate_of is not None else []),
            *(
                ["office-routing-inferred"]
                if catalogue.office_routing_status == "inferred-test-only"
                else []
            ),
        ]
        return draft.model_copy(
            update={
                "confidence": (
                    min(draft.confidence, 0.1)
                    if draft.category == UNCLASSIFIED
                    else draft.confidence
                ),
                "risk_flags": list(dict.fromkeys(flags)),
            }
        )
    except (json.JSONDecodeError, TypeError, ValueError):
        return _fallback_draft(
            catalogue,
            text,
            language or catalogue.default_language,
            cases,
        )


def canonical_proposal_json(draft: IntakeDraft) -> str:
    return json.dumps(
        draft.model_dump(by_alias=True, mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


__all__ = [
    "INTAKE_PROMPT_TEMPLATE_ID",
    "INTAKE_PROMPT_TEMPLATE_VERSION",
    "INTAKE_WORKFLOW_TYPE",
    "MAX_INTAKE_TEXT_CHARS",
    "MAX_KNOWN_CASES",
    "UNCLASSIFIED",
    "build_intake_messages",
    "canonical_proposal_json",
    "parse_draft",
    "propose_category",
    "propose_duplicate",
    "propose_from_rules",
    "propose_location",
    "propose_office",
]
