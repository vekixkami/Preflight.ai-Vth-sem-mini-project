# Preflight.ai — MASTER ROADMAP

_The engineering execution blueprint. This is the document we follow from MVP to production-ready, paid B2B SaaS. It is derived from [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md) and the product source-of-truth (`Preflight_ai_Project_Documentation.md`)._

**Owner:** CTO / Lead Engineer · **Status:** living document · **Last updated:** 2026-08-27

---

## How to read this roadmap

### Guiding principles (non-negotiable)
1. **Trust before features.** Nothing new ships until the product is honest, private, and reliable. A DLP tool that leaks data cannot sell, no matter how many features it has.
2. **Incremental over rewrite.** We keep the existing architecture (MV3 extension → service worker → FastAPI → dashboard, 3-layer pipeline). Every milestone is a bounded change to named files, not a greenfield.
3. **Preserve behavior unless it's a bug.** The fail-open philosophy, the "correct-don't-block" UX, and Layer 1 precision are assets. We protect them.
4. **Measure before we tune.** We do not claim detection quality we haven't measured on realistic (privacy-safe) data.
5. **Every milestone must move the needle on "would a startup pay monthly?"**

### Priority definitions
| Tier | Meaning | Gate |
|---|---|---|
| **P0 — Critical** | Actively dangerous or trust-destroying. The product is not safe to put in front of any customer until these are done. | Blocks pilots. |
| **P1 — Required before launch** | You cannot sell a paid subscription without these. | Blocks GA / paid launch. |
| **P2 — Important after launch** | Drives expansion, retention, and larger deals. | Blocks upmarket / renewals. |
| **P3 — Future vision** | Category-defining bets once product-market fit is proven. | Strategic. |

### Effort & risk legend
- **Engineering effort:** **Low** ≈ ≤1 dev-week · **Medium** ≈ 1–3 dev-weeks · **High** ≈ 3+ dev-weeks (rough, single competent engineer).
- **Risk level:** likelihood × blast radius of the change going wrong (regressions, customer-visible breakage, security exposure). **Low / Medium / High.**

### Phase overview
| Phase | Milestones | Theme | Indicative window |
|---|---|---|---|
| **P0** | M1–M6 | Honest, private, instant, authenticated | Weeks 1–4 |
| **P1** | M7–M19 | Sellable, multi-tenant, measurable | Weeks 5–12 |
| **P2** | M20–M25 | Enterprise expansion & stickiness | Post-launch quarter |
| **P3** | M26–M29 | Category leadership | 6–12+ months |

### Global implementation order
The **Estimated implementation order** field on each milestone is a single global sequence number (1 = do first). It respects dependencies. Milestones with adjacent numbers and no dependency between them may run in parallel if staffing allows.

```
P0:  1.M1-Privacy → 2.M2-Latency → 3.M3-Decision → 4.M4-Auth → 5.M5-API-Hardening → 6.M6-Interceptor-Health
P1:  7.M7-Postgres → 8.M8-Orgs/RBAC → 9.M9-RiskEngine → 10.M10-ML → 11.M11-Dashboard →
     12.M12-Compliance-Report → 13.M13-Admin/Onboarding → 14.M14-Billing → 15.M15-Testing/CICD →
     16.M16-Deploy/Infra → 17.M17-Monitoring → 18.M18-WebStore → 19.M19-Brand/Docs
P2:  20.M20-Layer3 → 21.M21-SSO/SCIM → 22.M22-Webhooks/SIEM → 23.M23-RBAC+/i18n/platforms →
     24.M24-Compliance-Portal → 25.M25-Own-SOC2/Pentest
P3:  26.M26-Enforcement → 27.M27-On-Device → 28.M28-Lineage/Marketplace → 29.M29-Expansion
```

### Dependency map (critical edges)
- **M1 (Privacy)** gates everything customer-facing — it is the credibility root.
- **M7 (Postgres/tenancy schema)** gates M8, M11, M12, M14 (anything multi-tenant or reporting).
- **M8 (Orgs/RBAC)** gates M13, M14, M21.
- **M3 (Decision telemetry)** gates M12 (compliance report needs proceed/cancel).
- **M9 (Risk engine)** gates M10 and M12 (one scoring truth for ML and reports).
- **M16 (Deploy/Infra)** should land alongside M7 so Postgres has a home.

---

# P0 — CRITICAL (trust, safety, reliability)

> _Theme: make the product honest, private, instant, and authenticated. None of these add features; all of them stop us from losing deals. Ship all six before any pilot._

---

## M1 — Privacy Remediation: Eliminate Prompt-Content Egress
**Domains:** Privacy, Security, Compliance

- **Objective:** Stop transmitting, persisting, and rendering raw prompt content. Replace `input_preview` with non-reversible metadata (finding **types + counts**, category, severity). Purge existing stored previews.
- **Why it matters:** The product currently violates its own Requirement 11 ("SHALL NOT write prompt content to disk/log"). Raw prompt substrings (first ~79 chars) reach SQLite and the dashboard, leaking live PII (e.g. `<redacted-10-digit-mobile>`). A DLP tool that leaks the data it protects is disqualified on sight.
- **Business impact:** Removes the single biggest deal-killer for the audit-driven ICP; makes the privacy story truthful for security questionnaires and DPAs. Directly unlocks the ability to demo without embarrassment.
- **Engineering effort:** **Low–Medium.** Mostly deletion + schema change + a purge script.
- **Risk level:** **Low.** Removing data flow is safer than adding it; main risk is the dashboard "recent activity" view needing a redacted replacement.
- **Dependencies:** None. **This is the root.**
- **Estimated implementation order:** **1**
- **Affected files/modules:** `src/content.js` (`previewPrompt`, `logEvent`), `src/background.js` (`telemetryPayloadFromLog`), `backend/main.py` (`ScanEventIn`, `scans` schema + `create_scan_event`), `dashboard/src/main.tsx` (RecentActivity), `src/popup.js`; new one-off `backend/scripts/purge_previews.py`.
- **Success criteria:**
  - No endpoint receives or stores any substring of prompt text (verified by inspecting payloads + DB schema).
  - Dashboard "recent activity" shows redacted findings ("1 phone, 1 Aadhaar"), never source characters.
  - Existing `input_preview` data purged; column dropped or nulled.
  - A test asserts the telemetry payload contains no free-text prompt field.

---

## M2 — Latency Decoupling: Instant Local Detection
**Domains:** Chrome Extension, Backend, Performance

- **Objective:** Make Layer 1 detection, the warning UI, and the send-decision fully local and synchronous. Convert telemetry to fire-and-forget (queue + async flush).
- **Why it matters:** ~3.5s latency on the regex-only path (your own known issue) because the decision is gated on a synchronous telemetry POST in `sendLogToBackend()`. This makes a "runs instantly, client-side" product feel broken.
- **Business impact:** Turns the core interaction from "laggy and annoying" to "instant and invisible" — the difference between employees tolerating vs. disabling the extension.
- **Engineering effort:** **Low–Medium.**
- **Risk level:** **Medium.** Touches the interception hot path; must preserve fail-open and not drop events.
- **Dependencies:** Best done right after M1 (same files). Independent of backend milestones.
- **Estimated implementation order:** **2**
- **Affected files/modules:** `src/content.js` (decouple `logEvent` from decision/UI), `src/background.js` (async/queued logging, respond immediately).
- **Success criteria:**
  - Time from "Send" to warning render for a Layer-1 hit is **< 150 ms** locally (no network in the critical path).
  - Telemetry failures never delay or block the user (fail-open preserved).
  - No event loss under offline conditions (queue + `chrome.alarms` flush verified).

---

## M3 — Decision & Action Telemetry Integrity
**Domains:** Chrome Extension, Compliance Reporting

- **Objective:** Capture and log `decision` (proceed / cancel) and `action_taken` for every warning, replacing the current `null`.
- **Why it matters:** Proceed-vs-cancel is the single datapoint the entire compliance-report value proposition depends on. It is currently never populated (defaults to `null` in `background.js`).
- **Business impact:** Unblocks the compliance report (M12) and the "proof of controls / behavior change" narrative that legal & management buy. Without it, the audit trail is empty.
- **Engineering effort:** **Low.**
- **Risk level:** **Low.**
- **Dependencies:** None; pairs naturally with M2 (same files). **Gates M12.**
- **Estimated implementation order:** **3**
- **Affected files/modules:** `src/content.js` (wire modal button handlers → decision), `src/background.js` (`normalizeDashboardEvent`, `telemetryPayloadFromLog`), `backend/main.py` (ensure persisted + queryable).
- **Success criteria:**
  - Every logged event has a non-null `decision` ∈ {proceed, cancel} and `action_taken`.
  - Dashboard can compute a proceed/cancel rate per employee, per category, per platform.
  - A test asserts both fields are populated on modal interaction.

---

## M4 — Real Authentication & Per-Org API Keys
**Domains:** Authentication, Security, Backend

- **Objective:** Replace the shared hardcoded token and in-memory map with per-org API keys (stored **hashed**, issued at onboarding, rotatable). Wire existing plan-gating to real keys. The extension receives its org's key via a linking flow, not a shipped constant.
- **Why it matters:** Today `tok_growth_bravo` is hardcoded into every shipped extension; auth is a 3-entry in-memory map; lifting the token upgrades your plan for free and there is no per-org isolation.
- **Business impact:** Prerequisite for tenancy, billing, per-customer data isolation, and any security questionnaire. Enables "each customer is isolated" — table stakes.
- **Engineering effort:** **Medium.**
- **Risk level:** **High.** Auth changes can lock out the extension/dashboard; needs careful rollout + a migration for existing demo tokens.
- **Dependencies:** Lighter without a DB, but real key storage wants M7 (Postgres). Acceptable to start with a hashed-key table in SQLite, then migrate. **Gates billing/tenancy.**
- **Estimated implementation order:** **4**
- **Affected files/modules:** `backend/auth.py` (real key model, hashing, lookup), `backend/main.py` (dependencies on protected routes), `src/background.js` (`PREFLIGHT_CONFIG.TOKEN` → stored per-install key + linking), new `backend/models/org_key.py`.
- **Success criteria:**
  - No secret/token is present in shipped extension source.
  - Keys are stored hashed; rotation and revocation work.
  - Requests are attributed to an `org_id`; plan tier derived from the org, enforced server-side.
  - Cross-org data access is impossible (verified by test).

---

## M5 — API & Transport Hardening
**Domains:** Security, Backend

- **Objective:** Lock CORS to known origins; require auth on `/api/scan-event` and all `/api/dashboard/*` endpoints; add per-org rate limiting; collapse to a single real backend URL and delete the fictional `api.sentinelai.app` path.
- **Why it matters:** CORS is `*` on an authed API; `/api/scan-event` and the dashboard API are unauthenticated (anyone can poison the store / read data); `background.js` posts telemetry to a non-existent domain (dead code + confused data-flow story).
- **Business impact:** Closes an open, abusable API surface; makes the data-flow diagram in a security review clean and honest.
- **Engineering effort:** **Low–Medium.**
- **Risk level:** **Medium.** Tightening CORS/auth can break the extension/dashboard if origins are misconfigured.
- **Dependencies:** M4 (auth must exist to enforce it).
- **Estimated implementation order:** **5**
- **Affected files/modules:** `backend/main.py` (`CORSMiddleware`, route dependencies, rate-limit middleware), `src/background.js` (remove `BACKEND_URL`/`/v1/events` dead path, single base URL), `src/services/telemetryReporter.js` (auth header).
- **Success criteria:**
  - CORS restricted to the extension + dashboard origins; wildcard removed.
  - All non-health endpoints require a valid org key.
  - Rate limiting enforced per org with sane limits; abuse returns 429.
  - Only one backend base URL exists in the codebase; no dead endpoints.

---

## M6 — Interception Resilience & Coverage Health
**Domains:** Chrome Extension, Monitoring

- **Objective:** Harden per-site interception with multiple fallback selectors + a `MutationObserver` re-attach, and emit an "interceptor health / coverage" heartbeat to telemetry.
- **Why it matters:** `content.js` relies on brittle per-site CSS selectors. When a vendor changes its UI, interception silently stops — and there's no signal. Silent failure in a DLP tool means undetected leaks and false assurance, which is worse than no tool.
- **Business impact:** Converts silent, reputation-destroying failures into observable, fixable alerts; lets you promise (and monitor) coverage per platform.
- **Engineering effort:** **Medium.**
- **Risk level:** **Medium.** Observer logic must not degrade page performance.
- **Dependencies:** M2 (health signal rides the async telemetry channel); surfaces in M11 dashboard and M17 monitoring.
- **Estimated implementation order:** **6**
- **Affected files/modules:** `src/content.js` (`SELECTORS` → resilient strategy, observer, self-test), `src/background.js` (health event), `manifest.json` (if new match patterns needed).
- **Success criteria:**
  - Interception survives a simulated selector change via at least one fallback.
  - A per-site "active/inactive" heartbeat is emitted and visible in monitoring.
  - Alert fires when coverage drops for a platform across many installs.

---

# P1 — REQUIRED BEFORE LAUNCH

> _Theme: turn a trustworthy prototype into a sellable, multi-tenant, measurable product. You cannot charge money without these._

---

## M7 — Data Layer Migration: Postgres + Alembic + Org Scoping
**Domains:** Backend, Infrastructure

- **Objective:** Move from SQLite + runtime `ALTER TABLE` to Postgres with Alembic migrations; add `org_id` scoping to all tables and queries (columns already exist, currently always null).
- **Why it matters:** SQLite + ad-hoc `ALTER TABLE` won't survive multi-tenant concurrency or safe schema evolution. Real customer data needs a real database and migration discipline.
- **Business impact:** Enables multi-tenancy, data isolation, and safe iteration — the foundation for orgs, billing, and reporting.
- **Engineering effort:** **Medium.**
- **Risk level:** **Medium.** Data-model change; needs a migration path and connection-pooling review.
- **Dependencies:** Pairs with M16 (infra to host Postgres). **Gates M8, M11, M12, M14.**
- **Estimated implementation order:** **7**
- **Affected files/modules:** `backend/main.py` (`init_database`, `get_db`, all queries), new `backend/db/` (engine, session), new `backend/migrations/` (Alembic), `backend/requirements.txt` (psycopg/SQLAlchemy).
- **Success criteria:**
  - All persistence goes through Postgres; no runtime `ALTER TABLE`.
  - Every query is org-scoped; migrations run cleanly forward.
  - Load test: sustained concurrent writes without lock errors.

---

## M8 — Organizations, Tenancy & RBAC (foundation)
**Domains:** Organizations, Enterprise features, Authentication

- **Objective:** First-class Organization, User, and Membership models with baseline roles (**Admin, Analyst, Employee/Viewer**). All data and actions scoped to an org and gated by role.
- **Why it matters:** Every B2B buyer expects "my company's data is separate and my admins control access." None of this exists today.
- **Business impact:** Unlocks selling to a company (not a person), admin/analyst separation, and the account structure billing attaches to.
- **Engineering effort:** **High.**
- **Risk level:** **Medium–High.** Core model; mistakes here are expensive to unwind.
- **Dependencies:** M4 (auth), M7 (Postgres). **Gates M13, M14, M21.**
- **Estimated implementation order:** **8**
- **Affected files/modules:** `backend/auth.py`, new `backend/models/{org,user,membership}.py`, `backend/main.py` (role dependencies), `dashboard/src/*` (role-aware views).
- **Success criteria:**
  - An org can have multiple users with distinct roles; role gates each endpoint.
  - Complete data isolation between orgs (test-verified).
  - Admin can list/invite/remove members.

---

## M9 — Risk Engine Consolidation
**Domains:** Risk Engine, Backend

- **Objective:** Extract a single, documented risk-scoring module that takes findings (L1) + classification (L2) [+ L3 later] and returns a calibrated risk level + explainable reasons. Remove duplicated logic.
- **Why it matters:** Risk logic is scattered: `_compute_risk` hardcodes thresholds in `main.py`, while `background.js` independently maps content types → categories twice. Divergent logic = inconsistent decisions and unmaintainable tuning.
- **Business impact:** One consistent, explainable risk score across extension, dashboard, and reports — essential for trust and for the "why was this flagged" UX.
- **Engineering effort:** **Medium.**
- **Risk level:** **Medium.** Must preserve current behavior except where it's a bug.
- **Dependencies:** Precedes M10 (ML) and M12 (reports) so both consume one truth.
- **Estimated implementation order:** **9**
- **Affected files/modules:** new `backend/risk_engine.py`, `backend/main.py` (`_compute_risk` → module), `src/background.js` (consume returned category/severity instead of re-deriving), `src/detectors.js` (`highestRisk` alignment).
- **Success criteria:**
  - One module owns risk scoring; extension no longer re-derives categories independently.
  - Every risk decision carries machine-readable reasons.
  - Golden-test suite pins current outputs; intentional changes are explicit.

---

## M10 — ML Pipeline Upgrade
**Domains:** ML Pipeline

- **Objective:** Replace `en_core_web_sm` NER with **GLiNER** (zero-shot, CPU-friendly, no training data); replace TF-IDF+LogReg document-type classifier with a **small-embedding / zero-shot sensitivity** classifier (reframed from "document type" to "should this leave?"); add **confidence calibration** (isotonic) and a **privacy-safe evaluation harness**.
- **Why it matters:** Current model trains on ~351 fully synthetic, template-homogeneous, English-only examples; TF-IDF learns lexical shortcuts, and the 85% accuracy is measured on its own synthetic distribution — optimistic vs. real, short, code-switched prompts. The objective is also wrong (doc-type ≠ sensitivity).
- **Business impact:** Real, measurable detection quality at near-zero marginal inference cost — the credibility of the "AI detection" claim and the Growth tier.
- **Engineering effort:** **High.**
- **Risk level:** **Medium.** New models add latency/footprint; must stay within Layer-2 latency budget and CPU deploy.
- **Dependencies:** M9 (risk engine consumes calibrated outputs). Eval harness must be privacy-safe (no real prompt storage).
- **Estimated implementation order:** **10**
- **Affected files/modules:** `backend/models/ner_model.py` (GLiNER), `backend/models/text_classifier.py` (embeddings/zero-shot + calibration), `backend/models/train_classifier.py` (retarget to sensitivity + calibration), `backend/data/*` (augmentation), new `backend/eval/` harness, `backend/requirements.txt`.
- **Success criteria:**
  - Entity coverage measurably improved on Indian names/orgs vs. baseline.
  - Precision/recall reported on a **realistic** (opt-in / structurally-real) eval set, not just synthetic.
  - Confidence calibrated (reliability curve); risk thresholds derived from the eval set.
  - Layer-2 P95 latency within budget on target CPU hardware.

---

## M11 — Decision-Oriented Dashboard + Auth (converge two dashboards)
**Domains:** Dashboard

- **Objective:** Rebuild the dashboard around decisions an admin acts on; add dashboard authentication + org scoping; converge the two dashboards (React app + `popup.js` mini-dashboard) onto the backend as the single source of truth (popup demoted to a status widget).
- **Why it matters:** Current dashboard is visually rich but not decision-oriented ("SOC theater"), has no auth, and disagrees with the popup (local storage vs SQLite). It also renders raw previews (fixed in M1).
- **Business impact:** This is what an admin logs into monthly and decides to renew on. Per-employee risk, proceed/cancel rate, tool usage, category trends, redacted incident drill-down, alert delivery.
- **Engineering effort:** **High.**
- **Risk level:** **Medium.**
- **Dependencies:** M1 (redaction), M3 (proceed/cancel), M7 (Postgres), M8 (org/roles).
- **Estimated implementation order:** **11**
- **Affected files/modules:** `dashboard/src/main.tsx`, `dashboard/src/api.ts`, `dashboard/src/components/*` (new views + auth), `src/popup.js`/`src/popup.html` (demote to status), `backend/main.py` (auth on dashboard API, new aggregate endpoints).
- **Success criteria:**
  - Dashboard requires login and shows only the caller's org data.
  - Displays per-employee risk leaderboard, proceed/cancel rate, per-tool usage, category trend, coverage health, redacted incident drill-down.
  - Popup no longer duplicates analytics; numbers reconcile with the backend.
  - Alerts can be delivered (email/Slack/webhook) for critical events.

---

## M12 — Compliance Reporting v1 (the paid artifact)
**Domains:** Compliance Reporting

- **Objective:** Generate a scheduled, DPDP-mapped monthly PDF: total violations + trend, DPDP sections referenced, proof-of-controls, incident log with timestamps (redacted), proceed/cancel behavior. Exportable and shareable with auditors.
- **Why it matters:** This is what legal/management actually buys — and it doesn't exist yet. Today we sell the packaging (warning + dashboard), not the product.
- **Business impact:** The core monetizable deliverable and the reason the audit-driven ICP signs. Turns "a warning tool" into "compliance evidence."
- **Engineering effort:** **Medium–High.**
- **Risk level:** **Medium.** DPDP mapping must be positioned as "evidence of controls," never "legally required" (positioning risk).
- **Dependencies:** M3 (decision data), M7 (data), M9 (risk reasons), background worker (from M16).
- **Estimated implementation order:** **12**
- **Affected files/modules:** new `backend/reporting/` (PDF builder, DPDP mapping), `backend/main.py` (report endpoints + schedule), `dashboard/src/*` (request/download UI).
- **Success criteria:**
  - One-click and scheduled monthly PDF per org, containing no raw prompt content.
  - DPDP-section mapping present and framed as evidence, not mandate.
  - A design-partner auditor confirms it's useful (validation gate).

---

## M13 — Admin Policy & Onboarding UX
**Domains:** Chrome Extension, Dashboard, Organizations

- **Objective:** Let an org self-configure: company keywords, enabled AI platforms, detector thresholds; and link the extension to the org via a real onboarding flow (replacing the fictional `refreshCompanyKeywords()` backend call).
- **Why it matters:** Customers can't currently configure anything; company keywords are read from `chrome.storage.local` but populated by a backend that doesn't exist. Self-serve GTM depends on this.
- **Business impact:** Enables self-serve onboarding, per-org customization (the "understands our data" wedge), and reduces white-glove setup cost.
- **Engineering effort:** **Medium.**
- **Risk level:** **Low–Medium.**
- **Dependencies:** M4 (keys), M8 (orgs). GTM model (self-serve vs white-glove) sets urgency.
- **Estimated implementation order:** **13**
- **Affected files/modules:** `backend/main.py` (policy/keyword endpoints), `src/background.js` (`refreshCompanyKeywords` → real endpoint), `src/detectors.js` (`getCompanyKeywords`), `dashboard/src/*` (policy UI), extension linking flow.
- **Success criteria:**
  - Admin sets keywords/platforms/thresholds in the dashboard; extension picks them up.
  - A new org can self-onboard and link the extension without manual backend work.

---

## M14 — Billing & Seat Management
**Domains:** Billing

- **Objective:** Razorpay Subscriptions integration (chosen for GST invoicing), plan tiers (Starter/Growth/Business) enforced server-side, seat allocation and limits.
- **Why it matters:** No revenue mechanism exists; pricing tiers map to detection depth but nothing enforces or bills them beyond a mock plan map.
- **Business impact:** Turns usage into revenue; enforces the layer-gating that justifies tier pricing; GST invoices Indian businesses expect.
- **Engineering effort:** **Medium–High.**
- **Risk level:** **High.** Payments + webhooks + entitlement correctness; billing bugs are customer-trust and financial risks.
- **Dependencies:** M4 (keys), M8 (orgs).
- **Estimated implementation order:** **14**
- **Affected files/modules:** new `backend/billing/` (Razorpay client, webhooks, entitlements), `backend/auth.py` (plan derives from subscription), `dashboard/src/*` (billing UI), `backend/main.py` (enforcement).
- **Success criteria:**
  - Subscribe/upgrade/downgrade/cancel work; GST invoices issued.
  - Seat limits enforced server-side; plan gates features (L2/L3) correctly.
  - Webhook signature verification and idempotency in place.

---

## M15 — Testing & CI/CD Foundation
**Domains:** Testing, CI/CD

- **Objective:** Real Layer-1 category tests (currently only PAN is exercised; `test/detectors.test.js` has no framework blocks), backend property/unit tests in CI (28 `test_` functions exist — gate them), extension smoke/e2e for interception, and a CI pipeline (lint, test, build, the ML accuracy gate) on every PR.
- **Why it matters:** "Every logged scan so far has been PAN-only" — real FP/FN behavior is unmeasured, and there's no automated gate preventing regressions in a security product.
- **Business impact:** Prevents shipping regressions that leak data or break interception; a prerequisite for moving fast without breaking trust.
- **Engineering effort:** **Medium.**
- **Risk level:** **Low.**
- **Dependencies:** Cuts across all; establish early in P1 and enforce thereafter.
- **Estimated implementation order:** **15**
- **Affected files/modules:** `test/detectors.test.js` (real cases per category), `backend/tests/*`, new `.github/workflows/ci.yml`, extension e2e harness.
- **Success criteria:**
  - Every Layer-1 detector has positive + negative tests; FP/FN tracked.
  - CI runs on every PR and blocks merge on failure (incl. ML accuracy gate).
  - A privacy regression test asserts no prompt content in any payload/log.

---

## M16 — Deployment & Infrastructure Baseline
**Domains:** Deployment, Infrastructure

- **Objective:** Containerize the backend; run multi-worker (gunicorn/uvicorn workers); host Postgres; manage secrets properly; ensure India data residency; add readiness/liveness probes.
- **Why it matters:** Today it's a single uvicorn process with a local SQLite file and no secret management or residency guarantee — not deployable for real customers, and residency matters for the DPDP story.
- **Business impact:** Makes the product hostable, scalable, and compliant on data location; supports uptime commitments.
- **Engineering effort:** **Medium.**
- **Risk level:** **Medium.**
- **Dependencies:** Pairs with M7 (Postgres). Supports M12 (report worker), M17.
- **Estimated implementation order:** **16**
- **Affected files/modules:** new `Dockerfile`, `docker-compose.yml`, deploy config/IaC, `backend/requirements.txt` (gunicorn, worker lib e.g. arq), secrets config, `backend/main.py` (readiness probe).
- **Success criteria:**
  - Reproducible container build; multi-worker serving; managed Postgres.
  - Secrets outside source; data hosted in an India region.
  - Readiness/liveness probes green; background worker running for reports/retries.

---

## M17 — Monitoring & Observability
**Domains:** Monitoring

- **Objective:** Structured logging that provably never contains prompt text, application metrics (latency, error rate, Layer-2 timings, interception coverage), uptime monitoring, and alerting.
- **Why it matters:** No metrics/tracing today; the global exception handler uses `logger.exception` — we must guarantee no prompt text reaches logs (Req 11), and we need to see failures before customers do.
- **Business impact:** Operational reliability, faster incident response, and evidence for uptime/SLA conversations.
- **Engineering effort:** **Medium.**
- **Risk level:** **Low.**
- **Dependencies:** M6 (coverage health feeds it), M16 (infra).
- **Estimated implementation order:** **17**
- **Affected files/modules:** `backend/main.py` (structured logging, metrics middleware), new `backend/observability/`, dashboards/alerts config.
- **Success criteria:**
  - Metrics + alerts live (error rate, latency, coverage, model timings).
  - Automated check confirms logs contain no prompt content.
  - On-call alerting for API down / coverage drop / error spike.

---

## M18 — Chrome Web Store Readiness
**Domains:** Chrome Web Store readiness, Chrome Extension

- **Objective:** Publish-ready listing: minimal justified permissions, a public privacy policy, data-use disclosures consistent with M1, store assets, and MV3 review compliance.
- **Why it matters:** Distribution requires passing Google review; over-broad permissions and a missing/contradictory privacy policy get extensions rejected — and a privacy-inconsistent listing would be a trust disaster for a DLP tool.
- **Business impact:** Unblocks legitimate distribution and self-serve installs; the privacy policy doubles as a sales/trust asset.
- **Engineering effort:** **Low–Medium.**
- **Risk level:** **Medium** (review rejections cause delays).
- **Dependencies:** M1 (privacy must be true before we publish a privacy policy), M4 (no secrets in bundle).
- **Estimated implementation order:** **18**
- **Affected files/modules:** `manifest.json` (permissions audit — `downloads`, `tabs` justified or dropped), new `PRIVACY_POLICY.md` + hosted page, store listing assets, `icons/*`.
- **Success criteria:**
  - Passes Google review; permissions are minimal and justified.
  - Public privacy policy matches actual data flow (post-M1).
  - Enterprise force-install (policy) documented for managed deployments.

---

## M19 — Brand & Documentation Cleanup
**Domains:** Chrome Extension, Backend, Compliance (credibility)

- **Objective:** Complete SentinelAI → Preflight rename in code (`window.SentinelDetectors`, `SENTINEL_LOG_EVENT`, `sentinel-flush-queue`, `api.sentinelai.app`) and fix documentation drift (`README.md`, `.kiro/specs/.../design.md`) to match reality.
- **Why it matters:** A buyer's technical advisor who opens DevTools or the repo sees a different product name and docs that contradict the code ("no backend/database") — a credibility hit.
- **Business impact:** Removes an easy "this is a prototype" signal; keeps spec/docs trustworthy as onboarding material.
- **Engineering effort:** **Low.**
- **Risk level:** **Low** (rename must be done carefully to avoid breaking message routing).
- **Dependencies:** Do after M5 (endpoint changes) to avoid churn.
- **Estimated implementation order:** **19**
- **Affected files/modules:** `src/detectors.js`, `src/background.js`, `src/content.js`, `README.md`, `.kiro/specs/preflight-layer2-backend/design.md`.
- **Success criteria:**
  - No "sentinel"/legacy-brand identifiers remain in shipped code.
  - README and design docs accurately describe the current architecture.

---

# P2 — IMPORTANT AFTER LAUNCH

> _Theme: expand deal size, move upmarket, and increase stickiness once the paid core is live._

---

## M20 — Layer 3: Privacy-Safe Contextual LLM Reasoning
**Domains:** ML Pipeline, Risk Engine

- **Objective:** Add LLM-based contextual reasoning for the **ambiguous middle band** only (Layer 1/2 uncertain), e.g. "client identity + business relationship" that no single field matches — gated hard on cost and privacy.
- **Why it matters:** It's the specced-but-unbuilt Business-tier (₹60k) justification and the true contextual-DPDP differentiator.
- **Business impact:** Justifies the top tier and catches leaks the cheaper layers can't.
- **Engineering effort:** **High.**
- **Risk level:** **High.** Sending a prompt to an LLM is itself data egress — must reconcile with M1 (customer's own key or contractual zero-retention, disclosed in DPA), or it re-creates the very problem we fixed.
- **Dependencies:** M9 (risk engine), M10 (only-on-uncertain gating), privacy/DPA decision.
- **Estimated implementation order:** **20**
- **Affected files/modules:** new `backend/models/layer3.py`, `backend/risk_engine.py`, `backend/main.py`, `backend/requirements.txt` (LLM SDK), billing gating.
- **Success criteria:**
  - Fires only on uncertain inputs; token/cost caps + caching enforced.
  - Egress path is privacy-safe and disclosed; measurable lift on ambiguous cases.

---

## M21 — Enterprise Identity: SSO/SAML + SCIM
**Domains:** Authentication, Enterprise features

- **Objective:** SAML/OIDC SSO and SCIM user provisioning/deprovisioning.
- **Why it matters:** Larger customers mandate SSO and automated provisioning in security reviews.
- **Business impact:** Unlocks upmarket deals; reduces admin overhead; common questionnaire requirement.
- **Engineering effort:** **High.**
- **Risk level:** **Medium.**
- **Dependencies:** M8 (orgs/roles).
- **Estimated implementation order:** **21**
- **Affected files/modules:** `backend/auth.py`, new `backend/sso/`, `dashboard/src/*`.
- **Success criteria:** SSO login works with a major IdP; SCIM provisions/deprovisions users.

---

## M22 — Integrations: Webhooks & SIEM Export
**Domains:** Enterprise features, Monitoring

- **Objective:** Outbound webhooks and SIEM export (Splunk / Microsoft Sentinel) for detection events (redacted).
- **Why it matters:** Security teams want Preflight events in their existing pipeline.
- **Business impact:** Embeds Preflight in the customer's security stack — increases stickiness and enterprise fit.
- **Engineering effort:** **Medium.**
- **Risk level:** **Low–Medium.**
- **Dependencies:** M7, M8, M17.
- **Estimated implementation order:** **22**
- **Affected files/modules:** new `backend/integrations/`, `backend/main.py`, `dashboard/src/*`.
- **Success criteria:** Signed webhooks with retries; documented SIEM export; no raw prompt content in payloads.

---

## M23 — Advanced RBAC, Multi-Language Detection & More Platforms
**Domains:** Chrome Extension, ML Pipeline, Enterprise features

- **Objective:** Granular RBAC, Hinglish/Hindi detection, and support for additional AI surfaces with the M6 resilience model.
- **Why it matters:** Indian employees code-switch (current models are English-only); larger orgs need finer roles; new AI tools keep appearing.
- **Business impact:** Broadens real-world coverage and org fit — reduces false negatives in the actual market.
- **Engineering effort:** **Medium–High.**
- **Risk level:** **Medium.**
- **Dependencies:** M8 (RBAC), M10 (model foundation), M6 (resilience).
- **Estimated implementation order:** **23**
- **Affected files/modules:** `backend/models/*`, `src/content.js`, `manifest.json`, `backend/auth.py`.
- **Success criteria:** Measurable Hinglish/Hindi detection; new platforms covered with health signals; role granularity shipped.

---

## M24 — Self-Serve Compliance Portal & Reporting Enhancements
**Domains:** Compliance Reporting, Dashboard

- **Objective:** Customer-facing compliance portal: historical reports, evidence bundles, custom periods, auditor-shareable links.
- **Why it matters:** Auditors and enterprise reviewers want self-service evidence access.
- **Business impact:** Reduces support load; strengthens the compliance value prop and renewals.
- **Engineering effort:** **Medium.**
- **Risk level:** **Low.**
- **Dependencies:** M12.
- **Estimated implementation order:** **24**
- **Affected files/modules:** `backend/reporting/`, `dashboard/src/*`.
- **Success criteria:** Self-serve report history + scoped auditor share links; no raw content exposure.

---

## M25 — Dogfood: Preflight's Own SOC 2 / Pen Test
**Domains:** Security, Compliance

- **Objective:** Pursue Preflight's own SOC 2 (or equivalent) and an independent penetration test.
- **Why it matters:** You sell compliance; the fastest way to close the student-led-vendor trust gap is to be certified and pen-tested yourself.
- **Business impact:** Major sales asset; directly counters the "trust gap" risk in the product doc.
- **Engineering effort:** **Medium** (process-heavy, spread over time).
- **Risk level:** **Low.**
- **Dependencies:** P0 + core P1 (must actually be secure first).
- **Estimated implementation order:** **25**
- **Affected files/modules:** cross-cutting (policies, evidence, remediations).
- **Success criteria:** Pen-test findings remediated; SOC 2 process underway with a report roadmap.

---

# P3 — FUTURE VISION

> _Theme: category-defining bets after product-market fit._

---

## M26 — Enforcement Mode (network/proxy hard-block) + Tamper Detection
**Domains:** Chrome Extension, Infrastructure, Enterprise features

- **Objective:** Optional hard-block enforcement (proxy/network layer) and tamper detection (alert admin when the extension is disabled) — moving from advisory to preventive control.
- **Why it matters:** Directly addresses the acknowledged structural limitation: a Chrome extension is bypassable without enforcement.
- **Business impact:** Opens regulated/enterprise buyers who require prevention, not just detection.
- **Engineering effort:** **High.**
- **Risk level:** **High.**
- **Dependencies:** Mature core + infra; strategic buy-in.
- **Estimated implementation order:** **26**
- **Affected files/modules:** new enforcement service, `manifest.json`, MDM/deployment tooling.
- **Success criteria:** Enforced blocking option for managed deployments; admin alerted on tamper.

---

## M27 — On-Device / Zero-Egress Model
**Domains:** ML Pipeline, Privacy

- **Objective:** Run detection fully on-device (or in the customer's tenant) so no prompt data ever leaves the customer boundary.
- **Why it matters:** The ultimate privacy posture — turns the earlier weakness into a differentiator; ideal for the most security-conscious buyers.
- **Business impact:** Premium privacy tier; strongest possible answer to "where does our data go?" (nowhere).
- **Engineering effort:** **High.**
- **Risk level:** **High.**
- **Dependencies:** M10 (efficient models).
- **Estimated implementation order:** **27**
- **Affected files/modules:** model packaging, extension runtime, backend fallback.
- **Success criteria:** Detection quality maintained with zero prompt egress in the on-device mode.

---

## M28 — Data Lineage & Detector Marketplace
**Domains:** Enterprise features, ML Pipeline

- **Objective:** Data-flow lineage (what categories flow where over time) and a marketplace of shareable/custom detectors.
- **Why it matters:** Moves from point-detection to a data-governance platform; community/custom detectors compound coverage.
- **Business impact:** Platform stickiness and expansion revenue.
- **Engineering effort:** **High.**
- **Risk level:** **Medium.**
- **Dependencies:** Mature detection + dashboard + orgs.
- **Estimated implementation order:** **28**
- **Affected files/modules:** new lineage service, detector SDK/registry, dashboard.
- **Success criteria:** Lineage views usable in audits; third-party/custom detectors installable per org.

---

## M29 — Geographic / Vertical Expansion
**Domains:** ML Pipeline, Compliance Reporting

- **Objective:** Extend beyond India (e.g. GDPR/CCPA mappings, region-specific identifiers) and into regulated verticals.
- **Why it matters:** India + DPDP is the wedge, not the ceiling; the same engine generalizes to other regimes.
- **Business impact:** Expands TAM once the India motion is proven.
- **Engineering effort:** **High.**
- **Risk level:** **Medium.**
- **Dependencies:** Proven India PMF; M10/M12 generalized.
- **Estimated implementation order:** **29**
- **Affected files/modules:** detection packs, compliance mappings, reporting.
- **Success criteria:** At least one additional regime supported end-to-end with region-specific detection + reporting.

---

# THE SINGLE MOST VALUABLE MILESTONE TO IMPLEMENT FIRST

## → **M1 — Privacy Remediation: Eliminate Prompt-Content Egress**

**Why this one, above all others:**

1. **It is existential, not incremental.** Every other milestone assumes we have a product a security-conscious buyer will trust. Today we do not: the tool leaks the exact data it's sold to protect (raw prompt snippets → SQLite → an unauthenticated dashboard, with live PII already stored). For the specific ICP — companies mid-audit, whose auditors ask "where does prompt data go?" — this single fact ends the deal. No feature compensates for it.

2. **It's the cheapest high-value work on the board.** It's **Low–Medium effort** and **Low risk** (we are *removing* a data flow, not adding one). Highest value-to-cost ratio in the entire roadmap — the definition of "do first."

3. **It has zero dependencies and unblocks the trust narrative.** M1 depends on nothing and is the root of the dependency graph. Until it's done, we cannot honestly publish a privacy policy (M18), pass our own SOC 2 (M25), or answer a security questionnaire truthfully. It makes every later "trust" claim real instead of aspirational.

4. **It converts your worst liability into your credibility.** "We never transmit or store your prompt content — only redacted detection metadata" is a *sales line*. Right now the truth is the opposite. M1 flips the single most damaging fact about the product.

**Practical execution note:** run M1 as the first sprint bundled with **M2 (latency)** and **M3 (decision telemetry)** — all three touch the same two files (`src/content.js`, `src/background.js`) and together produce the trustworthy core: **private, instant, and audit-logging.** That bundle is the smallest change that makes Preflight demoable to a real buyer without caveats. But if only one thing ships, it is **M1** — because it's the one that, left undone, makes everything else unsellable.

---

_This roadmap is a living document. As milestones complete or priorities shift (notably the open GTM decision — self-serve vs white-glove — and the Layer 3 privacy stance), we revise ordering here rather than in scattered notes. No code has been written; this is the blueprint we execute against._
