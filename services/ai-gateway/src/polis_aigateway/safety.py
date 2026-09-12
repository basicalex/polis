# SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Safety seam — prompt-injection detection.

Re-exports ``polis_core.detect_prompt_injection`` so there is one place to
extend the detector (new patterns, model-based scoring, etc.) without touching
every call site.
"""

from __future__ import annotations

from polis_core import InjectionVerdict, detect_prompt_injection

__all__ = ["InjectionVerdict", "detect_prompt_injection"]
