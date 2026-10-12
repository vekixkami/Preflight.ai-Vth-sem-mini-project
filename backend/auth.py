"""
auth.py — Token-to-org resolution and plan-tier gating.

All plan checks happen server-side. Client-supplied plan fields are never trusted.
This module is designed to be swappable: replace the in-memory _TOKEN_MAP with a
real database call without touching any endpoint logic in main.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OrgRecord:
    org_id: str
    plan: Literal["starter", "growth", "business"]


# ---------------------------------------------------------------------------
# Mock token store (pilot only — swap this function for a real DB lookup later)
# ---------------------------------------------------------------------------

_TOKEN_MAP: dict[str, OrgRecord] = {
    "tok_starter_acme": OrgRecord(org_id="org_acme", plan="starter"),
    "tok_growth_bravo": OrgRecord(org_id="org_bravo", plan="growth"),
    "tok_business_delta": OrgRecord(org_id="org_delta", plan="business"),
}

# Plan tier ordering — higher index = more permissive
_PLAN_TIERS: list[str] = ["starter", "growth", "business"]

# Feature availability by minimum required tier
_FEATURE_MIN_TIER: dict[str, str] = {
    "layer2": "growth",
    "layer3": "business",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_org(token: str) -> OrgRecord | None:
    """
    Return the OrgRecord associated with the given Bearer token.
    Returns None if the token is not recognised.
    """
    return _TOKEN_MAP.get(token)


def plan_includes(plan: str, feature: Literal["layer2", "layer3"]) -> bool:
    """
    Return True iff the given plan tier grants access to the specified feature.

    Tier hierarchy:  business ⊇ growth ⊇ starter

    Examples:
        plan_includes("growth",   "layer2") → True
        plan_includes("starter",  "layer2") → False
        plan_includes("business", "layer3") → True
        plan_includes("growth",   "layer3") → False
    """
    if plan not in _PLAN_TIERS:
        return False
    min_tier = _FEATURE_MIN_TIER.get(feature)
    if min_tier is None:
        return False
    return _PLAN_TIERS.index(plan) >= _PLAN_TIERS.index(min_tier)
