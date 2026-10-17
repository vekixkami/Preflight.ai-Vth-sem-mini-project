"""
main.py — Preflight Layer 2 Backend

FastAPI application:
  GET  /health                         — liveness probe, no auth
  GET  /config                         — org plan + feature flags
  POST /classify                       — ML classification + NER + risk scoring
  POST /api/scan-event                 — telemetry ingest (metadata only)
  GET  /api/dashboard/*                — aggregated reads for the admin dashboard

Every endpoint except /health requires a Bearer token (see auth.py), and
telemetry/dashboard data is scoped to the organisation that owns the token.

Models are loaded once at application startup (not per request).
Prompt content is never written to disk, stdout, or any log sink: telemetry
carries detection types, severity, decision and timing only.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from auth import OrgRecord, plan_includes, resolve_org

# ---------------------------------------------------------------------------
# Logging — application-level only; prompt content must never appear here
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("preflight.layer2")

# ---------------------------------------------------------------------------
# Lazy imports for ML components (loaded at startup via lifespan, not per req)
# ---------------------------------------------------------------------------

_classifier_predict = None   # set in lifespan startup
_ner_extract = None          # set in lifespan startup

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("PREFLIGHT_DB_PATH", BASE_DIR / "preflight_monitoring.sqlite3"))
VALID_SEVERITIES = {"critical", "high", "medium", "low", "none"}
# Employee decisions after a warning that kept the sensitive text from being sent as typed.
PREVENTED_DECISIONS = {"cancelled", "sanitized"}

# Longest prompt (typed text + extracted attachment text) accepted by /classify.
# The extension truncates to the same limit before calling.
MAX_CLASSIFY_CHARS = 200_000
# NER is the slow part and entity examples only need the opening of the text.
NER_MAX_CHARS = 50_000
# Safety cap on rows read for one dashboard request.
MAX_DASHBOARD_ROWS = 100_000


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        logger.error("%s is not a number; using %s", name, default)
        return default


# Below this the classifier is guessing (chance with 7 classes is ~0.14), so a
# sensitive label is not worth interrupting the employee for.
MIN_CONFIDENCE = _env_float("PREFLIGHT_MIN_CONFIDENCE", 0.20)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: Literal["ok"]


class ConfigResponse(BaseModel):
    org_id: str
    plan: str
    layer2_enabled: bool
    layer3_enabled: bool


class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_CLASSIFY_CHARS)


class EntityOut(BaseModel):
    text: str
    label: str


class ClassifyResponse(BaseModel):
    content_type: str
    confidence: float
    all_scores: dict[str, float]
    entities: list[EntityOut]
    risk_level: Literal["high", "medium", "low"]
    layer3_would_trigger: bool
    ner_backend: str
    latency_ms: float


class ScanEventIn(BaseModel):
    """Telemetry for one scan. Deliberately has no field for prompt text,
    previews, matched values or page titles; unknown fields from older
    extension builds (input_preview, page_title) are ignored and never stored."""

    timestamp: datetime
    layer1_detections: list[str] = Field(default_factory=list, max_length=100)
    layer2_detections: list[str] = Field(default_factory=list, max_length=100)
    severity: Literal["critical", "high", "medium", "low", "none"]
    decision: Optional[str] = Field(default=None, max_length=60)
    action_taken: Optional[str] = Field(default=None, max_length=80)
    latency_ms: float = Field(..., ge=0)
    source: str = Field(default="chrome_extension", max_length=80)
    extension_version: str = Field(default="unknown", max_length=40)
    browser_type: str = Field(default="chrome", max_length=40)
    ai_platform: str = Field(default="unknown", max_length=60)
    domain: str = Field(default="unknown", max_length=160)
    input_source: str = Field(default="text_field", max_length=60)
    user_id: Optional[str] = Field(default=None, max_length=120)
    device_id: Optional[str] = Field(default=None, max_length=120)


class ScanEventOut(BaseModel):
    id: int
    timestamp: str
    layer1_detections: list[str]
    layer2_detections: list[str]
    severity: str
    decision: Optional[str]
    action_taken: Optional[str]
    latency_ms: float
    source: str
    extension_version: str
    browser_type: str
    ai_platform: str
    domain: str
    input_source: str
    user_id: Optional[str]
    device_id: Optional[str]
    organization_id: Optional[str]


class ScanEventCreated(BaseModel):
    success: bool
    id: int


class DashboardSummary(BaseModel):
    total_scans: int
    layer1_detections: int
    layer2_detections: int
    critical_threats: int
    prevented_sends: int
    sent_anyway: int
    average_latency_ms: float
    backend_status: Literal["online"]
    extension_version: str
    browser_type: str
    last_telemetry_received: Optional[datetime]


class DashboardPoint(BaseModel):
    date: str
    total_scans: int
    threats: int
    layer1_events: int
    layer2_events: int


class CountItem(BaseModel):
    name: str
    count: int


class HeatmapItem(BaseModel):
    category: str
    layer1_count: int
    layer2_count: int
    critical_count: int
    total_count: int


class DashboardFilters(BaseModel):
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    severity: Optional[str] = None
    layer: Optional[Literal["layer1", "layer2"]] = None
    category: Optional[str] = None
    browser_type: Optional[str] = None
    ai_platform: Optional[str] = None
    domain: Optional[str] = None


# ---------------------------------------------------------------------------
# Application lifespan — load models once at startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load both ML models once at startup. Fail fast if classifier is missing."""
    global _classifier_predict, _ner_extract
    init_database()

    # --- Text Classifier ---
    try:
        from models.text_classifier import predict as clf_predict
        _classifier_predict = clf_predict
        logger.info("Text classifier loaded successfully.")
    except RuntimeError as exc:
        logger.critical(
            "Text classifier failed to load: %s\n"
            "Run 'python models/train_classifier.py' to generate the model file.",
            exc,
        )
        raise

    # --- NER Model (graceful degradation allowed) ---
    try:
        from models.ner_model import extract as ner_extract, NER_BACKEND
        _ner_extract = ner_extract
        logger.info("NER model loaded (backend: %s).", NER_BACKEND)
    except Exception as exc:  # noqa: BLE001
        logger.error("NER model failed to import: %s. NER will be unavailable.", exc)
        _ner_extract = None

    yield  # application runs here

    logger.info("Layer 2 backend shutting down.")


# ---------------------------------------------------------------------------
# Monitoring database helpers
# ---------------------------------------------------------------------------

# Columns that older builds stored prompt text in. They are dropped (or, on a
# SQLite too old to drop columns, blanked) at startup.
_PROMPT_BEARING_COLUMNS = ("input_preview", "page_title")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_database() -> None:
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                layer1_detections TEXT NOT NULL,
                layer2_detections TEXT NOT NULL,
                severity TEXT NOT NULL,
                decision TEXT NULL,
                action_taken TEXT NULL,
                latency_ms REAL NOT NULL,
                source TEXT NOT NULL,
                extension_version TEXT NOT NULL,
                browser_type TEXT NOT NULL,
                ai_platform TEXT NOT NULL DEFAULT 'unknown',
                domain TEXT NOT NULL DEFAULT 'unknown',
                input_source TEXT NOT NULL DEFAULT 'text_field',
                user_id TEXT NULL,
                device_id TEXT NULL,
                organization_id TEXT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        existing = {row[1] for row in conn.execute("PRAGMA table_info(scans)").fetchall()}
        for column, definition in {
            "ai_platform": "TEXT NOT NULL DEFAULT 'unknown'",
            "domain": "TEXT NOT NULL DEFAULT 'unknown'",
            "input_source": "TEXT NOT NULL DEFAULT 'text_field'",
            "organization_id": "TEXT NULL",
        }.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE scans ADD COLUMN {column} {definition}")

        # Privacy remediation: remove any stored prompt previews / chat titles.
        for column in _PROMPT_BEARING_COLUMNS:
            if column in existing:
                try:
                    conn.execute(f"ALTER TABLE scans DROP COLUMN {column}")
                except sqlite3.OperationalError:
                    default = "'unknown'" if column == "page_title" else "''"
                    conn.execute(f"UPDATE scans SET {column} = {default}")
                    logger.warning("Could not drop scans.%s; blanked it instead.", column)

        for index, column in (
            ("idx_scans_timestamp", "timestamp"),
            ("idx_scans_severity", "severity"),
            ("idx_scans_browser_type", "browser_type"),
            ("idx_scans_ai_platform", "ai_platform"),
            ("idx_scans_domain", "domain"),
            ("idx_scans_org", "organization_id"),
        ):
            conn.execute(f"CREATE INDEX IF NOT EXISTS {index} ON scans({column})")


def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def detection_category(name: str) -> str:
    value = name.lower()
    if value in {"aadhaar", "pan", "phone", "email", "bank_account", "ifsc", "gst"}:
        return "PII"
    if any(token in value for token in ("key", "secret", "password", "jwt", "token")) or value in {"db_url", "private_key", "env_content"}:
        return "Credentials"
    if value in {"financial_report", "financial_data", "forecast"}:
        return "Financial Data"
    if value in {"contract", "legal", "legal_agreement"}:
        return "Legal Data"
    if value in {"strategy_doc", "company_keyword", "source_code", "customer_data", "hr_doc", "business_data", "file_reference"}:
        return "Business Confidential"
    return "Other"


def parse_json_list(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def row_to_scan(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "timestamp": row["timestamp"],
        "layer1_detections": parse_json_list(row["layer1_detections"]),
        "layer2_detections": parse_json_list(row["layer2_detections"]),
        "severity": row["severity"],
        "decision": row["decision"],
        "action_taken": row["action_taken"],
        "latency_ms": row["latency_ms"],
        "source": row["source"],
        "extension_version": row["extension_version"],
        "browser_type": row["browser_type"],
        "ai_platform": row["ai_platform"],
        "domain": row["domain"],
        "input_source": row["input_source"],
        "user_id": row["user_id"],
        "device_id": row["device_id"],
        "organization_id": row["organization_id"],
    }


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def load_scan_rows(org: OrgRecord, filters: DashboardFilters, limit: Optional[int] = None) -> list[dict[str, Any]]:
    """Rows for one organisation, newest first. Filtering happens in SQL where
    possible so `limit` always means "this many matching rows"."""
    clauses: list[str] = ["organization_id = ?"]
    params: list[Any] = [org.org_id]
    if filters.start_date:
        clauses.append("timestamp >= ?")
        params.append(iso_utc(filters.start_date))
    if filters.end_date:
        clauses.append("timestamp <= ?")
        params.append(iso_utc(filters.end_date))
    if filters.severity:
        clauses.append("severity = ?")
        params.append(filters.severity)
    if filters.browser_type:
        clauses.append("browser_type = ?")
        params.append(filters.browser_type)
    if filters.ai_platform:
        clauses.append("ai_platform = ?")
        params.append(filters.ai_platform)
    if filters.domain:
        clauses.append("domain LIKE ? ESCAPE '\\'")
        params.append(f"%{_escape_like(filters.domain)}%")
    if filters.layer == "layer1":
        clauses.append("layer1_detections != '[]'")
    elif filters.layer == "layer2":
        clauses.append("layer2_detections != '[]'")

    query = "SELECT * FROM scans WHERE " + " AND ".join(clauses) + " ORDER BY timestamp DESC"
    # Category is derived from the detection names, so it is filtered in
    # Python and the limit must be applied afterwards.
    sql_limit = MAX_DASHBOARD_ROWS if (filters.category or limit is None) else min(limit, MAX_DASHBOARD_ROWS)
    query += " LIMIT ?"
    params.append(sql_limit)

    with get_db() as conn:
        rows = [row_to_scan(row) for row in conn.execute(query, params).fetchall()]

    if filters.category:
        wanted = filters.category
        rows = [
            row for row in rows
            if wanted in [detection_category(item) for item in row["layer1_detections"] + row["layer2_detections"]]
            or wanted in row["layer1_detections"]
            or wanted in row["layer2_detections"]
        ]
    if limit is not None:
        rows = rows[:limit]
    return rows


def get_filters(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    severity: Optional[str] = None,
    layer: Optional[Literal["layer1", "layer2"]] = None,
    category: Optional[str] = None,
    browser_type: Optional[str] = None,
    ai_platform: Optional[str] = None,
    domain: Optional[str] = None,
) -> DashboardFilters:
    if severity and severity not in VALID_SEVERITIES:
        raise HTTPException(status_code=400, detail="Invalid severity filter.")
    return DashboardFilters(
        start_date=start_date,
        end_date=end_date,
        severity=severity,
        layer=layer,
        category=category,
        browser_type=browser_type,
        ai_platform=ai_platform,
        domain=domain,
    )


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Preflight Layer 2 — ML Classifier Backend",
    version="1.0.0",
    description=(
        "Classifies employee prompts into sensitive content categories "
        "and extracts named entities for DPDP Act compliance."
    ),
    lifespan=lifespan,
)

# The extension's service worker and dashboard page use host permissions, so
# they are not subject to CORS. Browsers pages are limited to the local dev
# dashboard and extension pages unless PREFLIGHT_CORS_ORIGINS lists more
# (comma-separated exact origins).
_extra_origins = [o.strip() for o in os.environ.get("PREFLIGHT_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_extra_origins,
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


# ---------------------------------------------------------------------------
# Auth dependency — shared by every endpoint except /health
# ---------------------------------------------------------------------------

def require_org(authorization: Optional[str] = Header(default=None)) -> OrgRecord:
    """Resolve the Bearer token to an OrgRecord or raise HTTP 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unrecognised token.")
    org = resolve_org(authorization[len("Bearer "):].strip())
    if org is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unrecognised token.")
    return org


# ---------------------------------------------------------------------------
# Risk scoring — stateless, inline
# ---------------------------------------------------------------------------

_SENSITIVE_TYPES = frozenset({
    "contract", "financial_report", "hr_doc",
    "source_code", "strategy_doc", "customer_data",
})

_HIGH_CONFIDENCE_THRESHOLD = 0.75

_CONTRACT_HIGH_SIGNAL_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bagreement\b",
        r"\beffective date\b",
        r"\bremain in force\b",
        r"\bterminate\b|\btermination\b",
        r"\bwritten notice\b",
        r"\bgoverned by\b",
        r"\bdisputes?\b",
        r"\bparty\b|\bparties\b",
        r"\bshall\b",
    )
]


def _has_strong_contract_signals(text: str) -> bool:
    """Return True when text contains several concrete legal/agreement terms."""
    matches = sum(
        1 for pattern in _CONTRACT_HIGH_SIGNAL_PATTERNS
        if pattern.search(text)
    )
    return matches >= 4


def _compute_risk(
    content_type: str,
    confidence: float,
    plan: str,
    text: str = "",
) -> tuple[Literal["high", "medium", "low"], bool]:
    """
    Return (risk_level, layer3_would_trigger).

    Rules:
      - general → low, no layer3
      - contract with several concrete legal terms → high
      - sensitive + confidence below MIN_CONFIDENCE → low (classifier is guessing)
      - sensitive + confidence >= 0.75 → high, no layer3
      - sensitive + confidence <  0.75 → medium, layer3 if plan=business
    """
    if content_type not in _SENSITIVE_TYPES:
        return "low", False

    if content_type == "contract" and _has_strong_contract_signals(text):
        return "high", False

    if confidence < MIN_CONFIDENCE:
        return "low", False

    if confidence >= _HIGH_CONFIDENCE_THRESHOLD:
        return "high", False

    # ambiguous sensitive classification
    return "medium", plan_includes(plan, "layer3")


# ---------------------------------------------------------------------------
# Global exception handler — never expose internal stack traces
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception during %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal classification error."},
    )


# ---------------------------------------------------------------------------
# Endpoints
#
# These are plain `def` handlers on purpose: SQLite access and model inference
# are blocking, so FastAPI runs them in its threadpool instead of stalling
# the event loop for every other request.
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse, tags=["ops"])
def health() -> HealthResponse:
    """Liveness probe — no authentication required."""
    return HealthResponse(status="ok")


@app.post("/api/scan-event", response_model=ScanEventCreated, tags=["monitoring"])
def create_scan_event(event: ScanEventIn, org: OrgRecord = Depends(require_org)) -> ScanEventCreated:
    """
    Persist a telemetry event for the monitoring dashboard.
    The event is attributed to the organisation that owns the token, never to
    an organisation id supplied in the body.
    """
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO scans (
                timestamp, layer1_detections, layer2_detections,
                severity, decision, action_taken, latency_ms, source,
                extension_version, browser_type, ai_platform, domain,
                input_source, user_id, device_id, organization_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                iso_utc(event.timestamp),
                json.dumps(event.layer1_detections),
                json.dumps(event.layer2_detections),
                event.severity,
                event.decision,
                event.action_taken,
                event.latency_ms,
                event.source,
                event.extension_version,
                event.browser_type,
                event.ai_platform,
                event.domain,
                event.input_source,
                event.user_id,
                event.device_id,
                org.org_id,
            ),
        )
        conn.commit()
        return ScanEventCreated(success=True, id=cursor.lastrowid)


@app.get("/api/dashboard/summary", response_model=DashboardSummary, tags=["dashboard"])
def dashboard_summary(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> DashboardSummary:
    rows = load_scan_rows(org, filters)
    total = len(rows)
    latest = rows[0] if rows else None
    return DashboardSummary(
        total_scans=total,
        layer1_detections=sum(len(row["layer1_detections"]) for row in rows),
        layer2_detections=sum(len(row["layer2_detections"]) for row in rows),
        critical_threats=sum(1 for row in rows if row["severity"] == "critical"),
        prevented_sends=sum(1 for row in rows if row["decision"] in PREVENTED_DECISIONS),
        sent_anyway=sum(1 for row in rows if row["decision"] == "sent_anyway"),
        average_latency_ms=round(sum(row["latency_ms"] for row in rows) / total, 2) if total else 0,
        backend_status="online",
        extension_version=latest["extension_version"] if latest else "unknown",
        browser_type=latest["browser_type"] if latest else "unknown",
        last_telemetry_received=latest["timestamp"] if latest else None,
    )


@app.get("/api/dashboard/recent-events", response_model=list[ScanEventOut], tags=["dashboard"])
def dashboard_recent_events(
    limit: int = 50,
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> list[dict[str, Any]]:
    return load_scan_rows(org, filters, limit=max(1, min(limit, 200)))


@app.get("/api/dashboard/timeline", response_model=list[DashboardPoint], tags=["dashboard"])
def dashboard_timeline(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> list[DashboardPoint]:
    rows = load_scan_rows(org, filters)
    buckets: dict[str, dict[str, int]] = {}
    for row in rows:
        day = row["timestamp"][:10]
        bucket = buckets.setdefault(day, {"total_scans": 0, "threats": 0, "layer1_events": 0, "layer2_events": 0})
        bucket["total_scans"] += 1
        if row["severity"] in {"critical", "high"}:
            bucket["threats"] += 1
        if row["layer1_detections"]:
            bucket["layer1_events"] += 1
        if row["layer2_detections"]:
            bucket["layer2_events"] += 1
    return [DashboardPoint(date=day, **buckets[day]) for day in sorted(buckets)]


@app.get("/api/dashboard/severity", response_model=list[CountItem], tags=["dashboard"])
def dashboard_severity(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> list[CountItem]:
    filters.severity = None  # a severity breakdown ignores the severity filter
    rows = load_scan_rows(org, filters)
    counts = {severity: 0 for severity in ("critical", "high", "medium", "low")}
    for row in rows:
        if row["severity"] in counts:
            counts[row["severity"]] += 1
    return [CountItem(name=name, count=count) for name, count in counts.items()]


@app.get("/api/dashboard/categories", response_model=list[CountItem], tags=["dashboard"])
def dashboard_categories(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> list[CountItem]:
    filters.category = None  # a category breakdown ignores the category filter
    rows = load_scan_rows(org, filters)
    counts = {name: 0 for name in ("PII", "Credentials", "Financial Data", "Business Confidential", "Legal Data", "Other")}
    for row in rows:
        for detection in row["layer1_detections"] + row["layer2_detections"]:
            counts[detection_category(detection)] += 1
    return [CountItem(name=name, count=count) for name, count in counts.items()]


@app.get("/api/dashboard/heatmap", response_model=list[HeatmapItem], tags=["dashboard"])
def dashboard_heatmap(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> list[HeatmapItem]:
    rows = load_scan_rows(org, filters)
    aliases = {
        "Aadhaar": {"aadhaar"},
        "API Keys": {"openai_key", "anthropic_key", "aws_key", "generic_secret"},
        "Passwords": {"hardcoded_password", "password"},
        "Financial Data": {"financial_report", "financial_data"},
        "Business Data": {"strategy_doc", "company_keyword", "source_code", "customer_data", "hr_doc"},
    }
    heatmap: list[HeatmapItem] = []
    for label, names in aliases.items():
        layer1_count = 0
        layer2_count = 0
        critical_count = 0
        total_count = 0
        for row in rows:
            l1_hit = any(item in names for item in row["layer1_detections"])
            l2_hit = any(item in names for item in row["layer2_detections"])
            if l1_hit:
                layer1_count += 1
            if l2_hit:
                layer2_count += 1
            if l1_hit or l2_hit:
                total_count += 1
                if row["severity"] == "critical":
                    critical_count += 1
        heatmap.append(HeatmapItem(
            category=label,
            layer1_count=layer1_count,
            layer2_count=layer2_count,
            critical_count=critical_count,
            total_count=total_count,
        ))
    return heatmap


@app.get("/api/dashboard/source/browser-distribution", response_model=list[CountItem], tags=["dashboard"])
def dashboard_browser_distribution(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> list[CountItem]:
    filters.browser_type = None
    rows = load_scan_rows(org, filters)
    counts = {name: 0 for name in ("chrome", "edge", "brave", "safari", "firefox")}
    for row in rows:
        name = row["browser_type"].lower()
        if name in counts:
            counts[name] += 1
    return [CountItem(name=name, count=count) for name, count in counts.items()]


@app.get("/api/dashboard/source/ai-platform-distribution", response_model=list[CountItem], tags=["dashboard"])
def dashboard_ai_platform_distribution(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> list[CountItem]:
    filters.ai_platform = None
    rows = load_scan_rows(org, filters)
    counts = {name: 0 for name in ("chatgpt", "claude", "gemini", "copilot", "perplexity")}
    for row in rows:
        name = row["ai_platform"].lower()
        if name in counts:
            counts[name] += 1
    return [CountItem(name=name, count=count) for name, count in counts.items()]


@app.get("/api/dashboard/export/json", tags=["dashboard"])
def dashboard_export_json(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> list[dict[str, Any]]:
    return load_scan_rows(org, filters)


def _csv_safe(value: Any) -> Any:
    """Neutralise spreadsheet formula injection: several exported fields
    (domain, browser, platform…) come from the client."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


@app.get("/api/dashboard/export/csv", tags=["dashboard"])
def dashboard_export_csv(
    filters: DashboardFilters = Depends(get_filters),
    org: OrgRecord = Depends(require_org),
) -> Response:
    rows = load_scan_rows(org, filters)
    output = io.StringIO()
    fieldnames = [
        "id", "timestamp", "layer1_detections", "layer2_detections",
        "severity", "decision", "action_taken", "latency_ms", "source",
        "extension_version", "browser_type", "ai_platform", "domain",
        "input_source", "user_id", "device_id", "organization_id",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        export_row = {
            **row,
            "layer1_detections": "|".join(row["layer1_detections"]),
            "layer2_detections": "|".join(row["layer2_detections"]),
        }
        writer.writerow({key: _csv_safe(export_row.get(key, "")) for key in fieldnames})
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=preflight-dashboard.csv"},
    )


@app.get("/config", response_model=ConfigResponse, tags=["ops"])
def config(org: OrgRecord = Depends(require_org)) -> ConfigResponse:
    """
    Return the organisation's plan and feature flags.
    """
    return ConfigResponse(
        org_id=org.org_id,
        plan=org.plan,
        layer2_enabled=plan_includes(org.plan, "layer2"),
        layer3_enabled=plan_includes(org.plan, "layer3"),
    )


@app.post("/classify", response_model=ClassifyResponse, tags=["classify"])
def classify(body: ClassifyRequest, org: OrgRecord = Depends(require_org)) -> ClassifyResponse:
    """
    Classify a prompt and extract named entities.

    - Starter plan → 403
    - Growth / Business plan → full ClassifyResponse
    - Prompt content is never logged or persisted.
    """
    t_start = time.perf_counter()

    # Plan gate — server-side check, never trust client-supplied flags
    if not plan_includes(org.plan, "layer2"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Layer 2 is not included in the starter plan. "
                "Upgrade to Growth or Business to enable ML classification."
            ),
        )

    # --- Classification (any failure is caught by the global handler) ---
    clf_result = _classifier_predict(body.text)

    # --- NER ---
    try:
        if _ner_extract is not None:
            ner_result = _ner_extract(body.text[:NER_MAX_CHARS])
            entities = [EntityOut(text=e.text, label=e.label) for e in ner_result.entities]
            ner_backend = ner_result.ner_backend
        else:
            entities = []
            ner_backend = "unavailable"
    except Exception:
        logger.exception("NER raised an unexpected error; returning empty entities.")
        entities = []
        ner_backend = "error_fallback"

    # --- Risk scoring ---
    risk_level, layer3_would_trigger = _compute_risk(
        clf_result.content_type, clf_result.confidence, org.plan, body.text
    )

    latency_ms = (time.perf_counter() - t_start) * 1000.0

    return ClassifyResponse(
        content_type=clf_result.content_type,
        confidence=clf_result.confidence,
        all_scores=clf_result.all_scores,
        entities=entities,
        risk_level=risk_level,
        layer3_would_trigger=layer3_would_trigger,
        ner_backend=ner_backend,
        latency_ms=round(latency_ms, 2),
    )
