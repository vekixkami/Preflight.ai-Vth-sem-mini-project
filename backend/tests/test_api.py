"""API-level tests: authentication, organisation isolation, telemetry privacy,
CSV safety and risk scoring."""

from __future__ import annotations

import pathlib
import sqlite3
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient

import main
from auth import parse_token_config

GROWTH = {"Authorization": "Bearer tok_growth_bravo"}
STARTER = {"Authorization": "Bearer tok_starter_acme"}
BUSINESS = {"Authorization": "Bearer tok_business_delta"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATABASE_PATH", tmp_path / "test.sqlite3")
    with TestClient(main.app) as test_client:
        yield test_client


def event(**overrides):
    body = {
        "timestamp": "2026-10-18T10:00:00Z",
        "layer1_detections": ["pan"],
        "layer2_detections": [],
        "severity": "critical",
        "decision": "cancelled",
        "action_taken": "cancelled",
        "latency_ms": 12.5,
        "ai_platform": "chatgpt",
        "domain": "chatgpt.com",
    }
    body.update(overrides)
    return body


class TestAuthentication:
    @pytest.mark.parametrize("path", [
        "/config",
        "/api/dashboard/summary",
        "/api/dashboard/recent-events",
        "/api/dashboard/export/csv",
    ])
    def test_get_endpoints_require_token(self, client, path):
        assert client.get(path).status_code == 401
        assert client.get(path, headers={"Authorization": "Bearer nope"}).status_code == 401

    def test_scan_event_and_classify_require_token(self, client):
        assert client.post("/api/scan-event", json=event()).status_code == 401
        assert client.post("/classify", json={"text": "hello"}).status_code == 401

    def test_health_is_public(self, client):
        assert client.get("/health").json() == {"status": "ok"}

    def test_starter_plan_cannot_use_layer2(self, client):
        assert client.post("/classify", json={"text": "hello"}, headers=STARTER).status_code == 403

    def test_token_config_parsing_skips_malformed_entries(self):
        tokens = parse_token_config("tok_a:org_a:growth, bad, tok_b:org_b:enterprise,tok_c:org_c:starter")
        assert set(tokens) == {"tok_a", "tok_c"}
        assert tokens["tok_a"].plan == "growth"


class TestTelemetryPrivacy:
    def test_prompt_text_is_never_stored_or_returned(self, client):
        secret = "my PAN is ABCDE1234F"
        body = event(input_preview=secret, page_title=f"Chat about {secret}")
        assert client.post("/api/scan-event", json=body, headers=GROWTH).status_code == 200

        rows = client.get("/api/dashboard/recent-events", headers=GROWTH).json()
        assert len(rows) == 1
        assert "input_preview" not in rows[0] and "page_title" not in rows[0]
        assert secret not in str(rows)

        with sqlite3.connect(main.DATABASE_PATH) as conn:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(scans)")}
            dump = " ".join(str(v) for row in conn.execute("SELECT * FROM scans") for v in row)
        assert not {"input_preview", "page_title"} & columns
        assert secret not in dump

    def test_legacy_database_is_scrubbed_on_startup(self, tmp_path, monkeypatch):
        legacy = tmp_path / "legacy.sqlite3"
        with sqlite3.connect(legacy) as conn:
            conn.execute("""CREATE TABLE scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
                input_preview TEXT NOT NULL, layer1_detections TEXT NOT NULL,
                layer2_detections TEXT NOT NULL, severity TEXT NOT NULL, decision TEXT,
                action_taken TEXT, latency_ms REAL NOT NULL, source TEXT NOT NULL,
                extension_version TEXT NOT NULL, browser_type TEXT NOT NULL,
                page_title TEXT NOT NULL DEFAULT 'unknown', user_id TEXT, device_id TEXT,
                organization_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
            conn.execute("""INSERT INTO scans (timestamp, input_preview, layer1_detections, layer2_detections,
                severity, latency_ms, source, extension_version, browser_type, page_title)
                VALUES ('2026-06-26T00:00:00Z', 'pan card: ABCDE1234F', '[]', '[]', 'low', 1, 's', '1', 'chrome', 'secret title')""")
        monkeypatch.setattr(main, "DATABASE_PATH", legacy)
        main.init_database()
        with sqlite3.connect(legacy) as conn:
            dump = " ".join(str(v) for row in conn.execute("SELECT * FROM scans") for v in row)
        assert "ABCDE1234F" not in dump and "secret title" not in dump


class TestOrganisationIsolation:
    def test_each_org_only_sees_its_own_events(self, client):
        client.post("/api/scan-event", json=event(domain="a.example"), headers=GROWTH)
        client.post("/api/scan-event", json=event(domain="b.example"), headers=BUSINESS)

        growth = client.get("/api/dashboard/recent-events", headers=GROWTH).json()
        business = client.get("/api/dashboard/recent-events", headers=BUSINESS).json()
        assert [row["domain"] for row in growth] == ["a.example"]
        assert [row["domain"] for row in business] == ["b.example"]
        assert client.get("/api/dashboard/summary", headers=GROWTH).json()["total_scans"] == 1

    def test_client_cannot_choose_its_organisation(self, client):
        client.post("/api/scan-event", json=event(organization_id="org_delta"), headers=GROWTH)
        assert client.get("/api/dashboard/recent-events", headers=BUSINESS).json() == []
        assert client.get("/api/dashboard/recent-events", headers=GROWTH).json()[0]["organization_id"] == "org_bravo"


class TestDashboardQueries:
    def test_limit_applies_after_layer_filter(self, client):
        for i in range(5):
            client.post("/api/scan-event", json=event(timestamp=f"2026-10-18T10:0{i}:00Z", layer1_detections=[]), headers=GROWTH)
        client.post("/api/scan-event", json=event(timestamp="2026-10-18T09:00:00Z", layer1_detections=["pan"]), headers=GROWTH)
        rows = client.get("/api/dashboard/recent-events", params={"layer": "layer1", "limit": 3}, headers=GROWTH).json()
        assert len(rows) == 1  # the one old layer-1 event is not crowded out by newer clean scans

    def test_csv_export_neutralises_formulas(self, client):
        client.post("/api/scan-event", json=event(domain="=HYPERLINK(\"http://evil\")"), headers=GROWTH)
        text = client.get("/api/dashboard/export/csv", headers=GROWTH).text
        assert "'=HYPERLINK" in text and ",=HYPERLINK" not in text

    def test_summary_counts_decisions(self, client):
        for decision in ("cancelled", "sanitized", "sent_anyway", "sent_anyway", None):
            client.post("/api/scan-event", json=event(decision=decision), headers=GROWTH)
        summary = client.get("/api/dashboard/summary", headers=GROWTH).json()
        assert summary["prevented_sends"] == 2
        assert summary["sent_anyway"] == 2
        assert summary["total_scans"] == 5

    def test_invalid_severity_filter_is_rejected(self, client):
        assert client.get("/api/dashboard/summary", params={"severity": "bogus"}, headers=GROWTH).status_code == 400

    def test_domain_filter_treats_wildcards_literally(self, client):
        client.post("/api/scan-event", json=event(domain="chatgpt.com"), headers=GROWTH)
        rows = client.get("/api/dashboard/recent-events", params={"domain": "%"}, headers=GROWTH).json()
        assert rows == []


class TestClassifyLimits:
    def test_accepts_long_attachment_text(self, client):
        text = "Quarterly revenue was 40 crore. " * 3000  # ~96k chars
        response = client.post("/classify", json={"text": text}, headers=GROWTH)
        assert response.status_code == 200

    def test_rejects_text_over_the_limit(self, client):
        response = client.post("/classify", json={"text": "a" * (main.MAX_CLASSIFY_CHARS + 1)}, headers=GROWTH)
        assert response.status_code == 422


class TestRiskFloor:
    def test_low_confidence_sensitive_label_is_low_risk(self):
        assert main._compute_risk("strategy_doc", 0.15, "growth", "x") == ("low", False)

    def test_moderate_confidence_is_medium(self):
        assert main._compute_risk("strategy_doc", 0.30, "growth", "x") == ("medium", False)

    def test_high_confidence_is_high(self):
        assert main._compute_risk("hr_doc", 0.80, "growth", "x") == ("high", False)

    def test_layer3_flag_only_on_business_plan(self):
        assert main._compute_risk("hr_doc", 0.40, "business", "x") == ("medium", True)

    def test_general_is_always_low(self):
        assert main._compute_risk("general", 0.99, "business", "x") == ("low", False)
