"""
text_classifier.py — Text classification interface.

TF-IDF + Logistic Regression pipeline, trained by train_classifier.py.
Raises RuntimeError at import if the model file is absent, so the server
fails fast with a clear message rather than serving garbage results.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import joblib

# ---------------------------------------------------------------------------
# Model path
# ---------------------------------------------------------------------------

_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "saved_models", "text_classifier.joblib"
)
_MODEL_PATH = os.path.abspath(_MODEL_PATH)

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

CONTENT_TYPES = [
    "contract",
    "financial_report",
    "hr_doc",
    "source_code",
    "strategy_doc",
    "customer_data",
    "general",
]


@dataclass
class ClassifyResult:
    content_type: str
    confidence: float
    all_scores: dict[str, float]


# ---------------------------------------------------------------------------
# Model loading — happens at import time (once per process)
# ---------------------------------------------------------------------------

def _load_model():
    if not os.path.exists(_MODEL_PATH):
        raise RuntimeError(
            f"Classifier model not found at '{_MODEL_PATH}'. "
            "Run 'python models/train_classifier.py' to generate it."
        )
    bundle = joblib.load(_MODEL_PATH)
    return bundle["vectorizer"], bundle["model"]


_vectorizer, _model = _load_model()


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def predict(text: str) -> ClassifyResult:
    """
    Classify text into one of the seven content categories.

    Returns a ClassifyResult with content_type, confidence, and all_scores.
    Model is loaded once at module import — this function is purely CPU-bound inference.
    """
    vec = _vectorizer.transform([text])
    proba = _model.predict_proba(vec)[0]
    classes = _model.classes_

    all_scores = {cls: float(p) for cls, p in zip(classes, proba)}
    best_class = classes[proba.argmax()]
    confidence = float(proba.max())

    return ClassifyResult(
        content_type=best_class,
        confidence=confidence,
        all_scores=all_scores,
    )
