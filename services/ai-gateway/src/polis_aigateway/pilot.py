# SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

_MUNICIPALITY_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "public-lighting": (
        "rasvjet",
        "svjetilj",
        "lampa",
        "ulična rasvjeta",
        "ne svijetli",
        "mrak",
        "javna rasvjeta",
        "illuminazione",
        "lampione",
        "luce",
        "lighting",
        "street light",
        "streetlight",
    ),
}


@dataclass(frozen=True)
class PilotCatalogue:
    municipality_id: str
    category_ids: tuple[str, ...]
    category_keywords: dict[str, tuple[str, ...]]
    office_id: str
    office_routing_status: str
    settlements: tuple[str, ...]
    default_language: str


def _pilot_config_dir() -> Path:
    configured = os.getenv("PILOT_CONFIG_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[4] / "config" / "pilots"


def _category_records(data: dict[str, Any]) -> list[dict[str, Any]]:
    categories = data.get("categories")
    if isinstance(categories, list):
        return categories if all(isinstance(record, dict) for record in categories) else []
    category = data.get("category")
    return [category] if isinstance(category, dict) else []


@lru_cache(maxsize=None)  # noqa: UP033 — assignment requires functools.lru_cache
def load_catalogue(municipality_id: str) -> PilotCatalogue | None:
    """Load a validated pilot routing catalogue, failing closed on bad input."""
    if not _MUNICIPALITY_ID.fullmatch(municipality_id):
        return None

    try:
        raw = json.loads(
            (_pilot_config_dir() / f"{municipality_id}.json").read_text(encoding="utf-8")
        )
        if not isinstance(raw, dict) or raw.get("id") != municipality_id:
            return None

        municipality = raw.get("municipality")
        office = raw.get("office")
        settlements = raw.get("settlements")
        default_language = raw.get("defaultLanguage")
        categories = _category_records(raw)
        if (
            not isinstance(municipality, dict)
            or municipality.get("id") != municipality_id
            or not isinstance(office, dict)
            or not isinstance(office.get("id"), str)
            or not office["id"]
            or not isinstance(office.get("routingStatus"), str)
            or not isinstance(settlements, list)
            or not settlements
            or not all(isinstance(item, str) and item for item in settlements)
            or not isinstance(default_language, str)
            or not default_language
            or not categories
        ):
            return None

        category_ids: list[str] = []
        category_keywords: dict[str, tuple[str, ...]] = {}
        for category in categories:
            category_id = category.get("id")
            localized_names = category.get("name")
            if (
                not isinstance(category_id, str)
                or not category_id
                or not isinstance(localized_names, dict)
                or not localized_names
                or not all(isinstance(name, str) and name for name in localized_names.values())
            ):
                return None
            category_ids.append(category_id)
            names = tuple(dict.fromkeys(localized_names.values()))
            curated = _CATEGORY_KEYWORDS.get(category_id, ())
            category_keywords[category_id] = tuple(dict.fromkeys((*names, *curated)))

        return PilotCatalogue(
            municipality_id=municipality_id,
            category_ids=tuple(category_ids),
            category_keywords=category_keywords,
            office_id=office["id"],
            office_routing_status=office["routingStatus"],
            settlements=tuple(settlements),
            default_language=default_language,
        )
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


__all__ = ["PilotCatalogue", "load_catalogue"]
