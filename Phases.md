# Preflight.ai — Phases

This restates and sequences the priorities already established in `MASTER_ROADMAP.md` and `PRODUCT_AUDIT.md`, organized as build phases rather than a milestone list. Each phase has an explicit exit criterion — don't move to the next phase until the current one's criterion is actually true, not "mostly true."

Guiding principles (carried from `MASTER_ROADMAP.md`, still binding):
- **Trust before features.** A DLP product that leaks the data it's supposed to protect has no product to build features on top of.
- **Incremental, not a rewrite.** Every phase below assumes editing the existing codebase, not replacing it.
- **Preserve fail-open / "correct, don't block" behavior** at every phase — see `rules.md` Rule 2.
- **Measure before tuning** — don't optimize latency or accuracy without a number to compare against.

---

## Phase 0 — Trust & Safety Remediation (P0, blocking everything else)

**Why first:** the product's core promise ("we stop sensitive data leaving the browser") is currently contradicted by its own implementation — raw prompt fragments are persisted to an unauthenticated SQLite-backed dashboard. Nothing built on top of this is credible until it's fixed.

- Stop writing any prompt/file content fragment to disk (`input_preview` and equivalents) — replace with pure metadata (length, category, risk level).
- Fix the `decision`/`action_taken` null-logging bug (`content.js`'s `logEvent()` doesn't currently emit those exact field names — see prior debugging session).
- Add real authentication to `/api/scan-event` and every `/api/dashboard/*` endpoint (currently fully open).
- Restrict CORS from `allow_origins=["*"]` to the actual extension origin.
- Reduce Layer-1-only interception latency from the documented ~3.5s toward sub-second — audit the `await getCompanyKeywords()` call inside `SentinelDetectors.scan()`, which currently sits on the critical path.
- Remove or gate dead/dormant code paths that reference the old `SentinelAI`/`api.sentinelai.app` backend, since they're unreachable (nothing sets `authToken`) and confusing to anyone reading the code.

**Exit criterion:** an external security reviewer reading the code and the live database would conclude the product does what it says it does.

---

## Phase 1 — Real Auth, Real Storage, Real Access Control

**Why next:** Phase 0 fixes the leak; Phase 1 makes the backend something that could actually serve more than one pilot customer at a time.

- Replace `auth.py`'s hardcoded 3-token map with real per-org API keys / a real identity mechanism.
- Migrate SQLite → Postgres (or another real multi-tenant-safe store) with actual schema migrations, not `ALTER TABLE IF NOT EXISTS` checks scattered in app startup code.
- Introduce organizations and role-based access (admin vs. employee-level dashboard visibility).
- Add automated tests for every FastAPI endpoint (`main.py` currently has zero endpoint tests despite `httpx` being a listed dependency).

**Exit criterion:** onboarding a second real customer requires no code changes, only a config/data entry.

---

## Phase 2 — Detection Quality & Layer 2 Hardening

**Why next:** once the pipe is trustworthy and multi-tenant, the detection itself needs to be good enough to justify the product's pricing.

- Retrain/expand the Layer 2 classifier beyond ~350 synthetic, homogeneous examples — real (or realistically varied) training data, broader categories if resumes/personal-info-bearing documents are meant to be in scope (currently no category fits them well; see the document-scanning test finding).
- Reconsider the classifier's objective — document *type* (contract/HR/etc.) is a proxy for sensitivity, not sensitivity itself; evaluate whether a direct sensitivity/PII-density signal (e.g., GLiNER-style entity-dense scoring per `PRODUCT_AUDIT.md`'s recommendation) would perform better.
- Wire up the dead Verhoeff Aadhaar checksum and decide whether to enable the currently-disabled `AWS_SECRET_REGEX` (both exist but are unused — a decision, not an oversight, is needed here).
- Add UPI ID detection at Layer 2 (currently correctly deferred, but undelivered).
- Build real regression test coverage for detector diversity — audit notes every logged scan so far has been PAN-only in live testing.

**Exit criterion:** Layer 1 + Layer 2 combined hit an agreed accuracy/recall bar on a held-out, realistic (not self-authored) benchmark set, measured and written down.

---

## Phase 3 — Dashboard, Reporting & Admin Experience

**Why next:** the compliance report is literally the paid artifact per `PRD.md` — it needs to be built for real, not deferred indefinitely as "needs significant fixes, deliberately not the current priority."

- Rebuild/fix the two currently-disagreeing dashboards (the React SPA vs. `popup.js`'s inline analytics) into one consistent source of truth, or explicitly define what each is for.
- Automate the monthly compliance report generation (PDF export, DPDP section mapping, incident log, consent record) — currently described in `PRD.md` as a target output, not yet an automated pipeline.
- Real-time critical-violation alerting for admins.
- CSV/JSON export correctness — verify these actually reflect the fixed `decision`/`action_taken` fields from Phase 0.

**Exit criterion:** an admin can generate a report today that a SOC 2 auditor would accept without an engineer explaining caveats verbally.

---

## Phase 4 — Layer 3 (LLM Contextual Reasoning)

**Why after, not before:** Layer 3 is currently sold in the Business tier pricing but has zero implementation — spec it and build it before that pricing claim goes out further, but after the foundation (Phases 0–2) is solid, since Layer 3 is the most expensive layer to get wrong (false positives from an LLM reasoning step are more damaging to trust than a missed regex).

- Write `requirements.md` / `design.md` for Layer 3 (none exist yet), following the same EARS-style pattern used for Layer 2.
- Define what "contextual reasoning only Layers 1+2 can't catch" concretely means, with test cases (the DPDP Section 8 client-identity example from the PDF documentation is a starting point, not a spec).
- Implement with the same fail-open, no-raw-content-logged, plan-gated constraints as Layers 1/2.

**Exit criterion:** Layer 3 is real enough that Business-tier pricing is no longer selling a feature that doesn't exist.

---

## Phase 5 — Go-to-Market Readiness

**Why last (engineering-wise):** this phase is mostly non-engineering, but a few engineering dependencies gate it.

- Resolve self-serve vs. white-glove distribution (open product question — see `PRD.md` §7.1). This decides how much plan-switching/onboarding UX is needed before GTM, not after.
- Chrome Web Store submission readiness (privacy disclosures, permissions justification — much easier post-Phase 0/1 since the current permission/telemetry story wouldn't survive a store review as-is).
- Billing integration (Razorpay Subscriptions).
- Brand cleanup: finish the `SentinelAI` → `Preflight.ai` internal rename (deferred deliberately until after Phase 0–1 stabilize the code those names live in).

**Exit criterion:** a first paying customer outside the current pilot group can go from signup to protected browser in under a day, with billing, without an engineer in the loop.

---

## Explicitly deferred beyond these phases (P2/P3 in `MASTER_ROADMAP.md`, not re-litigated here)

SSO/SCIM, SIEM/webhook integrations, Hinglish/multilingual detection, a self-serve compliance portal, independent SOC 2/pentest for Preflight itself, hard-block enforcement mode, an on-device zero-egress model, data lineage tooling, geographic/vertical expansion. Don't pull these forward without a specific customer or revenue reason — they are lower-leverage than fixing the trust and detection-quality foundation first.
