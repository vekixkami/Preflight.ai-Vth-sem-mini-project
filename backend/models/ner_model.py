"""
ner_model.py — Named entity extraction with Indian business context.

Two code paths:
  1. spacy+ruler   — spaCy en_core_web_sm with a custom EntityRuler layered
                     on top for Indian rupee amounts, company suffixes, and cities.
  2. regex_fallback — pure-regex extractor activated when spaCy cannot be loaded.

The extract() function never raises. ner_backend reports which path was used.

Install the spaCy model once with:  python -m spacy download en_core_web_sm
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger("preflight.ner")

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class EntitySpan:
    text: str
    label: str  # "ORG" | "MONEY" | "PERSON" | "GPE"


@dataclass
class NERResult:
    entities: list[EntitySpan] = field(default_factory=list)
    ner_backend: str = "unknown"


# ---------------------------------------------------------------------------
# Indian-context patterns
# ---------------------------------------------------------------------------

_INDIAN_CITIES = [
    "Bengaluru", "Bangalore", "Mumbai", "Bombay", "Hyderabad", "Chennai", "Madras",
    "Pune", "Delhi", "New Delhi", "Kolkata", "Calcutta", "Ahmedabad", "Surat",
    "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Thane", "Bhopal",
    "Visakhapatnam", "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra",
    "Nashik", "Faridabad", "Meerut", "Rajkot", "Kalyan", "Vasai", "Coimbatore",
    "Noida", "Gurugram", "Gurgaon", "Chandigarh", "Kochi", "Cochin",
]

# Regex: rupee amounts — "5 crore", "80 lakh", "₹2.5 crore", "INR 40 lakh", "Rs 10 crore"
_RE_MONEY = re.compile(
    r"""
    (?:₹|INR|Rs\.?)\s*[\d,]+(?:\.\d+)?\s*(?:crore|lakh|lakhs|cr|L)
    |
    [\d,]+(?:\.\d+)?\s*(?:crore|lakh|lakhs|cr|L)\s+(?:rupees?)?
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Regex: Indian company suffixes
_RE_ORG = re.compile(
    r"\b[A-Z][A-Za-z0-9 &,.'()-]*\s+(?:Pvt\.?\s+Ltd\.?|Private\s+Limited|Limited|Ltd\.?|LLP|Inc\.?|Corp\.?|Enterprises|Solutions|Technologies|Infosystems)\b"
)

# Regex: capitalized city names from the static list
_RE_CITIES = re.compile(
    r"\b(" + "|".join(re.escape(c) for c in _INDIAN_CITIES) + r")\b"
)


# ---------------------------------------------------------------------------
# Regex fallback extractor
# ---------------------------------------------------------------------------

def _regex_extract(text: str) -> list[EntitySpan]:
    entities: list[EntitySpan] = []
    for match in _RE_MONEY.finditer(text):
        entities.append(EntitySpan(text=match.group().strip(), label="MONEY"))
    for match in _RE_ORG.finditer(text):
        entities.append(EntitySpan(text=match.group().strip(), label="ORG"))
    for match in _RE_CITIES.finditer(text):
        entities.append(EntitySpan(text=match.group().strip(), label="GPE"))
    return entities


# ---------------------------------------------------------------------------
# spaCy + EntityRuler setup — attempted once at module import
# ---------------------------------------------------------------------------

_nlp = None
_NER_BACKEND = "regex_fallback"

try:
    import spacy  # noqa: PLC0415

    _nlp = spacy.load("en_core_web_sm")

    # Add EntityRuler before the existing NER component so our patterns
    # take priority over the base model's predictions.
    ruler = _nlp.add_pipe("entity_ruler", before="ner")

    ruler_patterns = []

    # Indian rupee amounts
    for pattern_str in [
        [{"LIKE_NUM": True}, {"LOWER": {"IN": ["crore", "cr", "lakh", "lakhs", "l"]}}],
        [{"TEXT": {"REGEX": r"₹"}}, {"LIKE_NUM": True}, {"LOWER": {"IN": ["crore", "cr", "lakh", "lakhs"]}}],
        [{"LOWER": {"IN": ["inr", "rs"]}}, {"LIKE_NUM": True}, {"LOWER": {"IN": ["crore", "cr", "lakh", "lakhs"]}}],
    ]:
        ruler_patterns.append({"label": "MONEY", "pattern": pattern_str})

    # Indian cities
    for city in _INDIAN_CITIES:
        ruler_patterns.append({"label": "GPE", "pattern": city})

    # Indian company suffixes (phrase patterns)
    for suffix in ["Pvt Ltd", "Private Limited", "LLP", "Pvt. Ltd."]:
        ruler_patterns.append({
            "label": "ORG",
            "pattern": [{"TEXT": {"REGEX": r"[A-Z][A-Za-z]+"}}] + [
                {"TEXT": word} for word in suffix.split()
            ],
        })

    ruler.add_patterns(ruler_patterns)
    _NER_BACKEND = "spacy+ruler"

except Exception as exc:  # noqa: BLE001
    # spaCy or its model is unavailable — the regex fallback is used instead.
    logger.warning("spaCy NER unavailable (%s); using regex fallback.", exc)
    _nlp = None
    _NER_BACKEND = "regex_fallback"

# Which backend extract() uses (reported at startup; also returned per call).
NER_BACKEND = _NER_BACKEND


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def extract(text: str) -> NERResult:
    """
    Extract named entities from text.

    Always returns a NERResult — never raises, regardless of input or backend state.
    ner_backend indicates which code path was used.
    """
    try:
        if _nlp is not None:
            doc = _nlp(text)
            entities = [
                EntitySpan(text=ent.text.strip(), label=ent.label_)
                for ent in doc.ents
                if ent.label_ in {"ORG", "MONEY", "PERSON", "GPE"}
            ]
            return NERResult(entities=entities, ner_backend="spacy+ruler")
        else:
            entities = _regex_extract(text)
            return NERResult(entities=entities, ner_backend="regex_fallback")
    except Exception:  # noqa: BLE001
        # Last-resort safety net — return empty result rather than crashing
        try:
            entities = _regex_extract(text)
        except Exception:  # noqa: BLE001
            entities = []
        return NERResult(entities=entities, ner_backend="regex_fallback")
