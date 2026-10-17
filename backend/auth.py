"""
auth.py — Token-to-org resolution and plan-tier gating.

All plan checks happen server-side. Client-supplied plan fields are never trusted.

Tokens are configured with the PREFLIGHT_API_TOKENS environment variable
(see .env.example):

    PREFLIGHT_API_TOKENS="tok_abc:org_acme:growth,tok_def:org_beta:business"

When the variable is unset and PREFLIGHT_ENV is not "production", a set of
local development tokens is used so the pilot works out of the box. In
production an unset variable means every request is rejected.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger("preflight.auth")

Plan = Literal["starter", "growth", "business"]


@dataclass(frozen=True)
class OrgRecord:
    org_id: str
    plan: Plan


# Plan tier ordering — higher index = more permissive
_PLAN_TIERS: list[str] = ["starter", "growth", "business"]

# Feature availability by minimum required tier
_FEATURE_MIN_TIER: dict[str, str] = {
    "layer2": "growth",
    "layer3": "business",
}

# Local development only — never used when PREFLIGHT_ENV=production.
_DEV_TOKENS = "tok_starter_acme:org_acme:starter,tok_growth_bravo:org_bravo:growth,tok_business_delta:org_delta:business"


def parse_token_config(raw: str) -> dict[str, OrgRecord]:
    """Parse "token:org:plan,..." into a token map, skipping malformed entries."""
    tokens: dict[str, OrgRecord] = {}
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = [part.strip() for part in entry.split(":")]
        if len(parts) != 3 or not all(parts) or parts[2] not in _PLAN_TIERS:
            logger.error("Ignoring malformed PREFLIGHT_API_TOKENS entry (expected token:org:plan).")
            continue
        token, org_id, plan = parts
        tokens[token] = OrgRecord(org_id=org_id, plan=plan)  # type: ignore[arg-type]
    return tokens


def _load_tokens() -> dict[str, OrgRecord]:
    raw = os.environ.get("PREFLIGHT_API_TOKENS", "").strip()
    if raw:
        return parse_token_config(raw)
    if os.environ.get("PREFLIGHT_ENV", "development").lower() == "production":
        logger.error("PREFLIGHT_API_TOKENS is not set; all authenticated requests will be rejected.")
        return {}
    logger.warning("PREFLIGHT_API_TOKENS not set — using local development tokens. Do not deploy like this.")
    return parse_token_config(_DEV_TOKENS)


_TOKEN_MAP: dict[str, OrgRecord] = _load_tokens()


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
