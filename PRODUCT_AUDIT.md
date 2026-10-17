# Preflight.ai — Startup-Grade Product & Technical Audit

_Prepared as if this product ships to paying B2B customers tomorrow. Brutally honest by request. Every recommendation is incremental on the existing architecture unless a genuine bug forces otherwise; affected files are named so this doubles as an execution backlog._

**Reviewer stance:** technical co-founder. Sources read: entire extension (`manifest.json`, `src/*`), backend (`backend/**`), dashboard (`dashboard/src/*`), both Kiro specs (`.kiro/specs/preflight-layer2-backend/{requirements,design}.md`), the ML training pipeline + data, and the product source-of-truth (`Preflight_ai_Project_Documentation.md`, July 2026).

---

## 0. The One-Line Verdict

**The concept is sharp, the wedge (India + DPDP + compliance-audit ICP) is real, and Layer 1 is genuinely good engineering. But the product currently violates its own core promise: a DLP tool that is supposed to stop sensitive data from leaving the browser is itself transmitting and permanently storing raw snippets of that sensitive data — unauthenticated, unredacted, and rendering it on an unauthenticated dashboard.** Fix that contradiction and three reliability bugs, and you have something an audit-driven SMB will pay ₹8k/month for. Ship it as-is and the first security-conscious buyer who reads the network tab walks away — and is right to.

Everything below is in priority order within each section.

---

## 1. Executive Summary

### What Preflight.ai is
A Manifest V3 Chrome extension that intercepts a prompt in the moment between "Send" and the network request, runs a three-layer detection pipeline (regex → ML classifier → LLM reasoning, the third not built), and warns the employee with a plain-language, DPDP-framed explanation plus a "proceed anyway / cancel" choice. Both choices are meant to be logged as audit evidence. A FastAPI backend hosts Layer 2 (TF-IDF + Logistic Regression classifier + spaCy NER) and a monitoring/telemetry store; a React dashboard visualizes it.

### The honest state of it
This is a **strong MVP with a fatal privacy contradiction and three known reliability bugs**, wrapped in real product insight. The three-layer, cost-tiered design is the right mental model. Layer 1 is precise and well-hardened (Verhoeff-checksummed Aadhaar, label-anchored bank accounts, overlap resolution, fail-open). The ICP thesis — companies mid-SOC 2 / ISO 27001 / DPDP prep, already paying for Sprinto/Scrut — is the most defensible thing in the whole document.

But it will not survive contact with a technical buyer today, for reasons that are **fixable in weeks, not a rewrite**:

1. **Privacy contradiction (existential).** Raw prompt content (first ~79 chars) is sent to the backend as `input_preview`, persisted to SQLite, and rendered on the dashboard — directly contradicting Requirement 11 and `design.md`, and observably leaking real PII (e.g. a live phone number `<redacted-10-digit-mobile>`). A DLP product that leaks the data it protects is disqualified before the demo ends.
2. **~3.5s latency on the fail-open path** because the send decision / warning is coupled to a synchronous telemetry POST. This is in your own known-issues list. It makes a "runs instantly, client-side" product feel broken.
3. **`decision` / `action_taken` log as `null`** — so proceed-vs-cancel, the single datapoint your entire compliance-report value prop depends on, is not actually captured.
4. **No real authentication or tenancy.** A shared bearer token (`tok_growth_bravo`) is hardcoded into every shipped extension; auth is an in-memory map; `/api/scan-event` and the whole dashboard API are unauthenticated; CORS is `*`.

### The recommendation
Do **not** rewrite. Spend the first 30 days making the product _trustworthy and honest_ (privacy, latency, logging, auth), the next 60 making it _differentiated and sticky_ (the compliance report, a decision-oriented dashboard, a real ML upgrade that costs almost nothing to run). The architecture you have can carry you to your first ~50 paying customers. The gap is execution discipline and one hard privacy decision, not technology.

### Will companies pay for this?
Yes — **the audit-driven ICP specifically** — _if_ the compliance report exists, the tool is demonstrably privacy-safe, and it doesn't feel like a prototype. Not yet. The distance is ~90 days of focused work outlined in §9.

---

## 2. Product Audit

### 2.1 What is genuinely good
- **The wedge is real and narrow.** "Companies actively inside a SOC 2 / ISO 27001 / DPDP audit, already paying Sprinto/Scrut" is a buyer with budget, urgency, and a deadline. The doc's own ICP discipline note ("'any small Indian startup' is too broad") is exactly right.
- **India-specific detection is a moat incumbents won't bother building.** Aadhaar (with Verhoeff checksum, not just a regex), PAN, GST, IFSC, Indian NER (crore/lakh, Pvt Ltd/LLP, Indian cities). Nightfall/Purview/Netskope do not care about this; for an Indian SMB it's the difference between "understands us" and "generic US tool."
- **"Correct, don't just block."** Offering a sanitized, safe-to-send version (`SAFE_REPLACEMENTS` → `[SYNTHETIC_*]`) instead of a hard block is a genuinely better UX than the "computer says no" DLP norm, and it matches the "Clearance before you send" positioning.
- **DPDP timing.** Rules notified Nov 2025, enforcement May 2027 — an 18-month window where buyers feel the deadline but lack tooling. Good market timing.
- **Cost-tiered pipeline.** Escalating regex → ML → LLM only when cheaper layers are uncertain is the correct architecture for margin at SMB price points.

### 2.2 What is weak / unfinished
- **The compliance report — your actual paid artifact — does not exist yet.** The employee warning and dashboard are built; the "auto-generated monthly DPDP-mapped PDF" (the thing legal/management pays for) is not. You are currently selling the packaging, not the product.
- **Layer 3 is vaporware in the pricing table.** The Business tier (₹60k) is sold on "adds Layer 3 (LLM reasoning)," which is _not specced_. Charging for an unbuilt tier is a trust and (if invoiced) a contractual risk.
- **The product can't be configured by a customer.** Company keywords are read from `chrome.storage.local` (`detectors.js` `getCompanyKeywords()`), populated by `refreshCompanyKeywords()` in `background.js` — which calls `https://api.sentinelai.app/v1/companies/me/keywords`, **a backend that does not exist.** There is no onboarding, no admin policy UI, no way for a buyer to say "also flag our internal codenames."

### 2.3 What reduces customer trust / signals "prototype"
- **The privacy leak (see §4).** Nothing erodes trust faster for this specific buyer.
- **Brand bleed-through.** `window.SentinelDetectors`, `SENTINEL_LOG_EVENT`, the `sentinel-flush-queue` alarm, and `BACKEND_URL = "https://api.sentinelai.app"` all still say _SentinelAI_. A buyer who opens DevTools sees a different product name than the one on the invoice.
- **Two backends, one fictional.** `background.js` posts telemetry to a placeholder domain that isn't real, while the working API is `localhost:8000`. Split-brain.
- **Documentation that contradicts the code.** `README.md` says "no backend, no dashboard, Layer 2 not built"; `design.md` says "no database, no cloud dependencies." Both are false now. A buyer's technical advisor reading the repo loses confidence.
- **Two different dashboards showing two different numbers** (React/backend vs the `popup.js` mini-dashboard reading `chrome.storage.local`). They will disagree.

### 2.4 What would impress a founder
- The Aadhaar Verhoeff check and the label-anchored / overlap-resolved detection in `detectors.js` — this is not vibe-coded, it's careful.
- The Kiro spec discipline: EARS requirements, 24 correctness properties, a benchmark suite, and a **hard accuracy gate** (`train_classifier.py` `sys.exit(1)` if test <0.85 or benchmark <0.80). Most seed-stage teams have nothing like this.
- The fail-open philosophy done correctly (synchronous `preventDefault` before any `await`).

### 2.5 What makes companies reject it
1. It leaks their data (§4).
2. It's slow (§3.2).
3. It's trivially bypassable and there's no deployment-enforcement story (MDM/force-install) offered — acknowledged in the doc, but a buyer needs the mitigation, not just the caveat.
4. No SSO, no RBAC, no audit log, no org management — every enterprise security questionnaire asks for these.

### 2.6 Competitive analysis (their §8)
| Competitor | Category | What they do better | Relevance to you |
|---|---|---|---|
| **Prompt Security, Harmonic Security** | AI/GenAI DLP (closest peers) | Mature prompt-level detection, broad app coverage, enterprise trust | Direct competitors. Watch closely; they validate the category. |
| **Nightfall AI** | API/SaaS DLP + ML detectors | Strong ML detector library, API-first, integrations | Closest on _detection_. You compete on India + price + compliance report. |
| **LayerX** | Enterprise browser security | Browser-native enforcement, not just warn | Shows the "browser extension" model is fundable — but they enforce. |
| **Microsoft Purview** | Enterprise DLP suite | Everything, bundled into M365 | **The commoditization threat** (your doc names it). If Copilot ships free prompt-warnings, your free-tier value erodes. Compete where Purview is overkill/unaffordable: sub-300-person Indian SMB mid-audit. |
| **Netskope, Symantec DLP** | Network/endpoint DLP incumbents | Full-surface coverage, enterprise sales machine | Not your buyer. Too expensive/heavy for the ICP. Ignore. |
| **Cyberhaven** | Data lineage / insider risk | Data-flow tracing | Different problem. Ignore for now. |

**Where you realistically win:** India-native detection, DPDP-mapped compliance evidence, ₹8k entry price, self-serve speed for a buyer with an audit deadline, "correct not block" UX.
**Features you absolutely need to be credible:** privacy-by-design (currently violated), the compliance report, reliability, basic auth/tenancy/RBAC, an enforcement/deployment story.
**Features to ignore (for now):** network/endpoint DLP, email/SaaS DLP, data lineage, on-prem, a broad connector marketplace. These are how you lose 12 months building toward Netskope and die.

---

## 3. Technical Audit

### 3.1 Chrome extension review (their §2)
**Good:** MV3; service worker centralizes network egress so content scripts need no backend host permissions; correct interception (`document`-capture listeners, synchronous `preventDefault`/`stopImmediatePropagation` before `await`); fail-open everywhere; local-first Layer 1.

**Weaknesses (ranked):**
1. **Latency coupling (bug, §3.2).**
2. **Selector fragility + silent failure.** `content.js` `SELECTORS` are per-site CSS selectors for ChatGPT/Claude/Gemini/Copilot/Perplexity. When any vendor ships a UI change, interception silently stops — and there is **no telemetry that says "I failed to attach"**. Silent failure in a DLP tool = undetected leaks = _false_ assurance, which is worse than no tool. **Affected:** `src/content.js`. **Fix:** multiple fallback selectors per site, a `MutationObserver` re-attach, and an "interceptor health" heartbeat in telemetry so you can see coverage break in the dashboard before a customer does.
3. **Hardcoded shared token** (`background.js` `PREFLIGHT_CONFIG.TOKEN`). See §4.
4. **Two backend URLs / dead code path** (`api.sentinelai.app`).
5. **`decision`/`action_taken` not captured** (§3.3).
6. **Brand debt** in identifiers/messages.
7. **`popup.js` re-implements a whole second dashboard** — scope creep and a second source of truth. The popup should be a lightweight status view ("protected on this site: yes/no", today's counts), not a rival analytics surface.

**Cross-site compatibility:** the model (per-site selector maps) works but does not scale maintainably to more surfaces without the resilience layer above. Every new AI tool is a new brittle selector set.

### 3.2 The latency bug (highest-impact reliability fix)
Your doc reports ~3.5s for _regex-only_ detection and correctly hypothesizes the modal is gated on a synchronous telemetry POST. The path in `background.js` `sendLogToBackend()` does `await storeDashboardEvent()` then `await sendTelemetry()` before returning `{success:true}` to the content script. **Detection, the warning UI, and the send-decision must be 100% local and synchronous; telemetry must be fire-and-forget.** Layer 1 findings are already computed in-page (`detectors.js scan()`); the UI should render the instant that returns, and logging should never sit on the critical path. **Affected:** `src/content.js` (decouple `logEvent` from the decision), `src/background.js` (make logging async/queued, respond immediately). This alone converts the product from "feels broken" to "instant."

### 3.3 Detection engine review (their §3)
**Layer 1 is the strong asset — invest here, it's where precision/recall gains are cheapest and most defensible.**
- **Precision strengths:** Verhoeff-validated Aadhaar (kills the classic false positive of any 12 digits), label-anchored bank-account detection, container-overlap resolution (`resolveOverlappingFindings`), key-format coverage (OpenAI incl. `sk-proj-`, Anthropic, AWS, JWT, DB URLs, private keys).
- **Known gaps / false negatives:**
  - **UPI IDs** are deferred to Layer 2 but Layer 2 doesn't detect them either → currently undetected. A UPI VPA (`name@bank`) is trivial regex; put it back in Layer 1.
  - **No Indian passport, voter ID (EPIC), driving licence, vehicle reg, DIN, CIN, UAN, ESIC** — all common in HR/finance prompts.
  - **No credit/debit card (Luhn)** — a glaring omission for a DLP tool.
  - **No physical address / pincode heuristics.**
- **False positives to watch:** `SOURCE_CODE`, `ENV_ASSIGNMENT`, `GENERIC_API_KEY`, `HARDCODED_PASSWORD` are inherently noisy; without per-detector precision telemetry you can't tune them. The doc admits _all live scans so far have been PAN-only_ — so real-world FP/FN rates are **unmeasured**.
- **Risk scoring is a scattered heuristic**, not a coherent model: `_compute_risk` in `backend/main.py` hardcodes thresholds (e.g. sensitive + confidence ≥0.75 → high), and `background.js` independently maps content types → categories twice (`categoryForLayer1Type`, `categoryForLayer2Type`). Business logic is duplicated across the extension and backend. **Consolidate** into one documented risk function.

**How a production AI-DLP detection stack should work:** deterministic high-precision matchers (regex + checksums + validators) for structured secrets/IDs → a fast semantic layer for _unstructured sensitivity_ (contracts, strategy, customer lists) → contextual reasoning only for the ambiguous middle band → a single calibrated risk score with explainable reasons → continuous precision/recall measurement on a privacy-safe eval set. You have the shape; you're missing calibration, measurement, and the semantic upgrade (see §6).

### 3.4 Backend review (their §6)
**Good:** clean FastAPI + Pydantic; models loaded once via `lifespan`; server-side plan gating exists (`auth.py` `plan_includes`); a global exception handler that returns a generic message; a real test suite (28 `test_` functions).

**Weaknesses:**
- **No real auth / tenancy** (§4). `auth.py` is an in-memory `_TOKEN_MAP` of three demo tokens.
- **SQLite + runtime `ALTER TABLE`** in `init_database()`. Fine for a single-node MVP; will not survive multi-tenant scale or concurrent writes, and ad-hoc `ALTER TABLE` is a migration framework waiting to corrupt. Move to **Postgres + Alembic** before customer #1's data matters.
- **`/api/scan-event` is unauthenticated** (`main.py:524`) — anyone can poison the monitoring store / dashboard.
- **CORS `allow_origins=["*"]`** on an authenticated API.
- **No rate limiting** on `/classify` (the expensive path) or telemetry.
- **No background job runner.** Retry/queue logic lives in the _extension_ (`chrome.alarms`); the backend has none. Report generation, batch processing, and retries need a worker (arq/RQ/Celery) — pick the simplest (arq) for a startup.
- **Single uvicorn process** (no gunicorn/workers in `requirements.txt`); no concurrency/scaling story, no readiness probe beyond `/health`, no structured logging/metrics/tracing.
- **`logger.exception` in the global handler** — verify no prompt text ever reaches logs on any path (the whole point of Req 11).

### 3.5 Technical debt register (their §10)
| # | Debt | Files | Severity |
|---|---|---|---|
| 1 | Raw prompt preview transmitted/persisted/rendered | `content.js`, `background.js`, `main.py`, `dashboard/src/main.tsx` | **Critical** |
| 2 | Latency coupling to telemetry POST | `content.js`, `background.js` | **Critical** |
| 3 | `decision`/`action_taken` never populated | `content.js` (+ `background.js`) | High |
| 4 | Shared hardcoded token; in-memory auth | `background.js`, `auth.py` | High |
| 5 | CORS `*`; unauthenticated `/api/scan-event` + dashboard API | `main.py` | High |
| 6 | Two dashboards / dual data path (local vs SQLite) | `popup.js`, `dashboard/*`, `background.js` | High |
| 7 | Dead/fictional backend URL | `background.js` | Medium |
| 8 | SQLite + ad-hoc `ALTER TABLE` migrations | `main.py` | Medium (High at scale) |
| 9 | Risk logic duplicated across extension + backend | `background.js`, `main.py` | Medium |
| 10 | Brand rename incomplete (SentinelAI → Preflight) | `detectors.js`, `background.js`, messages, alarms | Medium |
| 11 | Doc drift (README/design contradict reality) | `README.md`, `design.md` | Medium |
| 12 | Synthetic-only ML data; no L1 category tests | `train_classifier.py`, `test/detectors.test.js` | Medium |
| 13 | Selector fragility, no interceptor-health telemetry | `content.js` | High (silent failures) |

---

## 4. Security Audit

**This section is the one that decides whether you close or lose security-conscious buyers.**

### 4.1 CRITICAL — the product leaks the data it exists to protect
- **Chain:** `content.js` `logEvent()` sets `input_preview = previewPrompt(text)` (first ~79 chars of the **raw** prompt) → `background.js` `telemetryPayloadFromLog()` forwards it → `POST /api/scan-event` → `main.py:543` persists it to `scans.input_preview` → `dashboard/src/main.tsx` RecentActivity renders it.
- **This directly violates your own spec:** Requirement 11 — _"SHALL process text payloads entirely in memory and SHALL NOT write prompt content to disk, stdout, or any log sink"_ — and `design.md`'s "no database" claim.
- **The code rationalizes it:** `main.py:528` claims "full prompts are rejected by contract... and never required here." But a **79-char preview of a leaked prompt is still prompt content**, and 79 chars is more than enough to hold a full phone number, Aadhaar, email, or customer name. A live example (`<redacted-10-digit-mobile>`) is already sitting in the monitoring store and on the dashboard.
- **Why it's existential for _this_ ICP:** you sell to companies whose auditors and enterprise customers ask "where does prompt data go?" Your honest answer today is "we copy the first 79 characters of every flagged prompt to our server, forever, in plaintext, and show it on a dashboard with no login." That ends the deal.
- **Fix (P0):** stop sending `input_preview` entirely. Send only **structured, non-reversible** metadata: finding _types_ and _counts_, severity, category, latency, platform, timestamps. If a human-readable "why" is needed for the incident view, render it client-side from finding types (e.g. "1 phone number, 1 email") — never the source characters. Purge the existing column. **Affected:** `content.js` (`previewPrompt`/`logEvent`), `background.js` (`telemetryPayloadFromLog`), `main.py` (`ScanEventIn`, `scans` schema), `dashboard/src/main.tsx` (RecentActivity), `popup.js`.

### 4.2 HIGH — authentication & authorization
- **Shared, hardcoded bearer token** shipped in every extension (`background.js`: `TOKEN: "tok_growth_bravo"`, with `tok_business_delta` named in a comment). Anyone who unzips the extension has it; it's also the plan-gating credential, so lifting it upgrades your tier for free.
- **Auth is an in-memory map** (`auth.py` `_TOKEN_MAP`) — no real identity, no per-org isolation, no rotation, no expiry, no hashing.
- **`/api/scan-event` and the entire `/api/dashboard/*` surface are unauthenticated.** The dashboard has no login component at all (`dashboard/src/components/` contains only `ui/`).
- **Fix (P0/P1):** per-org API keys, stored hashed, issued at onboarding, rotatable; the extension receives its org's key via a real linking flow (not a shipped constant); authenticate telemetry and dashboard endpoints; scope every query by `org_id` (the columns already exist and are always `null`).

### 4.3 HIGH — network & transport
- **CORS `allow_origins=["*"]`** (`main.py`) on an authed API. Lock to the extension origin + the dashboard origin.
- **No rate limiting / abuse controls** anywhere.
- **Fictional egress endpoint** (`api.sentinelai.app`) — dead code that also muddies your data-flow story for a security review. Delete or implement.

### 4.4 STRUCTURAL — enforcement boundary (acknowledged in doc)
A Chrome extension is bypassable (incognito, another browser, disable extension). This is inherent to the category, but the buyer needs the **mitigation packaged**: a documented MDM / Chrome Enterprise force-install policy, tamper signals ("extension disabled" alert to admin), and honest positioning ("detective + advisory control, enforce via managed devices"). Don't imply away; sell the deployment guide.

### 4.5 Positioning risk (legal/marketing)
The doc is refreshingly honest that **DPDP does not mandate prompt-level DLP** — the framing is a defensible mapping, not a legal requirement. Keep that discipline in all external claims; "helps you evidence controls for DPDP" is safe, "required for DPDP compliance" is not.

---

## 5. UX Audit

- **The employee warning is the product's soul and mostly right:** inline, plain-language, category-grouped (personal/credentials/business), proceed/cancel. Preserve this. Two improvements: (a) make the "safe-to-send corrected version" a one-click _replace-in-place_ action (it's your differentiator — make it the primary button), (b) render instantly (§3.2).
- **The proceed/cancel choice isn't being recorded** (§3.3) — so from the employee's view it works, but the audit trail is empty. This is a silent UX-to-compliance gap.
- **Two dashboards confuse the story.** The `popup.js` mini-dashboard and the React dashboard will show different numbers (local storage vs backend). Decide: popup = personal/site status; React = the org admin surface.
- **No onboarding / settings UX.** A customer cannot add company keywords, choose platforms, or link their org without a backend flow that doesn't exist. For a self-serve motion (an open GTM question in your doc), this is the gating UX.
- **No "am I protected right now?" affordance.** Given selector fragility, employees and admins need a visible "Preflight is active on this site" indicator, and admins need coverage health.

---

## 6. ML Audit (their §4 — the deep dive you asked for)

### 6.1 What exists
`train_classifier.py`: **TF-IDF (1–2 grams, max 10k features, sublinear_tf) + Logistic Regression (C=1.0, `class_weight="balanced"`, lbfgs)**, 7 classes, 80/20 stratified split, a 35-example out-of-training benchmark, and a hard acceptance gate (≥0.85 test / ≥0.80 benchmark or `sys.exit(1)`). NER is separate: spaCy `en_core_web_sm` + an EntityRuler for Indian entities, with a pure-regex fallback (`ner_model.py`).

### 6.2 The honest problems (ranked)
1. **The training data is ~351 fully synthetic, LLM-generated examples (~50/class), stylistically homogeneous, and English-only.** Every contract reads "agreement between Company A and Company B for…", every financial line says "revenue was X crore." The model will learn **lexical shortcuts** ("crore", "FY2024", "agreement between", "Ltd") — not semantics. Reported 85%+ accuracy is on _same-distribution synthetic_ held-out data and is **wildly optimistic** vs. real, short, messy, code-switched employee prompts.
2. **Wrong objective.** The classifier answers _"what document type is this?"_ — but the product question is _"does this contain sensitive data that shouldn't leave?"_. A "general" EBITDA question is safe to send; a pasted customer list is not. The sensitivity decision is a **downstream heuristic** (`_compute_risk`) decoupled from what the model optimizes.
3. **TF-IDF has zero generalization to paraphrase/synonym.** A real prompt phrased unlike the templates ("here are our Q3 numbers, help me summarize") can miss entirely.
4. **English-only, no Hinglish/Hindi** — in a market where employees code-switch constantly. The dataset even contains "translate into formal Hindi" as a _general_ example, implying Hindi content is unmodeled.
5. **Single-label softmax; uncalibrated confidence.** Real prompts are multi-category (code containing customer data). `predict_proba` max is thresholded at 0.75 in `_compute_risk`, but LR-on-TF-IDF confidence is poorly calibrated **especially out-of-distribution** → confidently wrong on the exact novel inputs that matter. No Platt/isotonic calibration.
6. **NER is weak where it counts.** `en_core_web_sm` is a small English model, poor on Indian names; the EntityRuler + regex fallback carry most of the Indian load, and NER's contribution to risk is thin.
7. **No feedback loop, no drift monitoring, no data versioning.** A static `joblib` in the repo. And you (correctly) shouldn't collect real prompts to retrain — so you need a **privacy-safe evaluation** strategy, not more synthetic self-congratulation.

### 6.3 Recommended architecture — what a startup should actually build (not the most expensive)
**Keep the tiered, cost-aware shape. Change the components, not the philosophy.**

- **Layer 1 (regex/validators): keep and expand.** Cheapest, most precise, fully explainable, on-device, zero cost. Add UPI, card+Luhn, passport, DL, voter ID, DIN/CIN/UAN. This is your best ROI and needs no ML.
- **Layer 2 entities → replace `en_core_web_sm` with GLiNER.** GLiNER is a small, CPU-friendly, **zero-shot** NER model: you declare entity labels ("person name", "company", "customer identifier", "address") with **no training data**, and it generalizes far better than a small spaCy model or regex for unstructured names/orgs. Biggest accuracy-per-rupee win available, and it sidesteps your data problem.
- **Layer 2 category/sensitivity → embeddings, not TF-IDF.** A small sentence-transformer (e.g. `bge-small-en` / `e5-small`, CPU-fast) + a lightweight logistic/nearest-centroid head generalizes to paraphrase; or **zero-shot classification via a small NLI model** for category labels with no training data. **Reframe the target from document-type to sensitivity tiers.** Add **confidence calibration** (isotonic) and set thresholds from a real (opt-in) eval set.
- **Layer 3 (LLM reasoning): only for the ambiguous middle band, and only privacy-safe.** This is your contextual-DPDP differentiator (e.g. "client identity + business relationship" that no single field matches). But sending a prompt to an LLM **is data egress** — reconcile with §4 by using the customer's own key or a contractual zero-retention endpoint, disclosed in the DPA. Gate hard on cost: only on Layer-2-uncertain inputs, cap tokens, cache.
- **What to skip:** don't fine-tune a HuggingFace transformer per class (you lack the data and it's slow/costly), and don't route every prompt through an LLM (kills margin at ₹8k and adds latency + egress). GLiNER + embeddings get you most of the way at near-zero marginal cost.

**Net:** hybrid, tiered, on-device-first — exactly your intent — but fix the _objective_ (sensitivity), the _entity model_ (GLiNER), the _representation_ (embeddings), _calibration_, and _privacy-safe evaluation_.

---

## 7. Dashboard Audit (their §5)

**CTO test — "if I paid monthly, would this help me decide anything?" Today: not really. It's visually rich but not decision-oriented (SOC theater).**

- **Remove immediately:** the raw `input_preview` column (§4). Replace with redacted finding types + counts.
- **Add the metrics an admin actually acts on** (most already promised in your doc's "Admin" view but not built): **per-employee risk leaderboard**, **proceed-vs-cancel rate** (needs §3.3 fixed — it's the compliance KPI), **per-AI-tool usage**, **category trend over time**, **high-risk employee list**, **coverage/interceptor health** (which sites are protected right now).
- **Incident drill-down without raw data:** "Employee X, ChatGPT, 14:32, flagged: 1 Aadhaar + 1 phone, chose: proceed" — evidence, not content.
- **The compliance report is the paid artifact and is missing:** scheduled monthly PDF, DPDP-section mapping, trend, incident log with timestamps, proof-of-controls. Build this; it's what legal/management buys.
- **Governance gaps:** no dashboard auth, no org/user management, no RBAC (admin vs analyst vs viewer), no alert _delivery_ (email/Slack/webhook), no report scheduling.
- **Converge the two dashboards** onto the backend as the single source of truth; demote `popup.js` to a status widget.

---

## 8. Architecture Review & Enterprise Readiness (their §7)

### 8.1 Architecture — keep the bones, fix the joints
The extension → service-worker → FastAPI → dashboard topology is sound for this stage. The problems are **integrity of the seams**, not the boxes: dual data paths (local `dashboardEvents` vs SQLite), duplicated risk logic, a fictional egress URL, and no tenancy. Target state (incremental):
- One backend, one data path, one source of truth (Postgres).
- One risk-scoring module, imported by both surfaces (or computed backend-side only).
- Split responsibilities server-side: **classify service** vs **events/telemetry ingestion** vs **reporting/worker** — even if they're one deployable today, keep the modules clean.
- Structured logging that provably never contains prompt text; health/readiness probes; containerized; multi-worker.

### 8.2 Enterprise-readiness gap list (what's missing to sell to real companies)
**Table stakes (blockers):** real authN/Z; organizations & multi-tenancy; RBAC; audit logs (immutable); privacy-by-design (currently violated); data residency in India; a status/uptime story.
**Near-term differentiators:** admin policy config (per-org keywords/detectors/thresholds); billing + seat management (Razorpay, chosen for GST invoicing); scheduled compliance reports; alert delivery.
**Later:** SSO/SAML + SCIM provisioning; webhooks / SIEM export (Splunk, Sentinel); API for customers; MDM/force-install enforcement + tamper detection.
**Dogfood:** you're selling compliance — pursue your _own_ SOC 2 / a pen test early; it's both a sales asset and the right thing.

---

## 9. Prioritized Roadmap — 90-Day Sellable MVP

_Discipline: this is deliberately short. The goal is "a security-conscious Indian SMB mid-audit signs a ₹8k–25k/month contract without their technical advisor vetoing it." Everything here serves that._

### P0 — Must-have (weeks 1–4): _stop losing deals; be honest and instant_
1. **Kill the privacy leak.** Remove `input_preview` end-to-end; send only redacted types/counts; purge the column. (§4.1)
2. **Decouple detection/UI from telemetry** → instant local warnings; fire-and-forget logging. (§3.2)
3. **Capture `decision`/`action_taken`** (proceed/cancel). (§3.3)
4. **Real per-org API keys** (hashed, issued at onboarding); remove the shared hardcoded token; wire the existing plan-gating to real keys. (§4.2)
5. **Lock CORS to known origins; authenticate `/api/scan-event` + dashboard API; add basic rate limiting.** (§4.3)
6. **One backend URL** — delete the `api.sentinelai.app` path (or implement it). (§4.3)
7. **Interceptor-health telemetry + fallback selectors** so silent coverage failures are visible. (§3.1)
8. **Compliance Report v1** (DPDP-mapped PDF export) — the paid artifact.

### P1 — High priority (weeks 5–10): _differentiate & retain_
9. **ML upgrade:** GLiNER for entities; embeddings/zero-shot for category reframed to _sensitivity_; calibrate confidence; build a privacy-safe eval set. Expand Layer 1 (UPI, card+Luhn, more Indian IDs). (§6)
10. **Decision-oriented dashboard:** per-employee risk, proceed/cancel rate, tool usage, category trends, redacted incident drill-down, alert delivery; add dashboard auth + org scoping; converge the two dashboards. (§7)
11. **Postgres + Alembic; org/tenancy model; immutable audit log.** (§3.4, §8)
12. **Admin policy config + onboarding UI** (company keywords, platforms). (§2.2)
13. **Billing + seat management (Razorpay).**
14. **MDM/force-install deployment guide + tamper alerts** (enforcement story). (§4.4)

### P2 — Nice-to-have (post-90-day, as demand pulls)
15. **Layer 3 LLM reasoning** for the ambiguous band — privacy-safe (customer key / zero-retention). The Business-tier justification.
16. Webhooks / SIEM export; SSO/SAML + SCIM; scheduled reports; RBAC roles; Hinglish/Hindi detection; more platforms + resilience.

### P3 — Future vision
17. Network/proxy **enforcement** mode (real block) for regulated buyers; on-device model for zero-egress; data lineage; detector marketplace; self-serve compliance portal; expansion beyond India.

---

## 10. Technical Recommendations (consolidated, incremental, with affected files)

| Priority | Recommendation | Why | Affected files |
|---|---|---|---|
| P0 | Remove raw prompt preview from transmit/persist/render; redact to types+counts; purge column | Existential trust + your own Req 11 | `content.js`, `background.js`, `main.py`, `dashboard/src/main.tsx`, `popup.js` |
| P0 | Decouple send-decision/UI from telemetry POST | Fixes ~3.5s latency | `content.js`, `background.js` |
| P0 | Populate `decision`/`action_taken` | Core compliance KPI + report | `content.js`, `background.js` |
| P0 | Per-org hashed API keys; drop shared token; enforce plan via real key | Real auth/tenancy | `background.js`, `auth.py`, `main.py` |
| P0 | CORS allowlist; auth `/api/scan-event` + dashboard API; rate limit | Close open API | `main.py` |
| P0 | Single backend URL; delete fictional egress | Data-flow integrity | `background.js` |
| P0 | Interceptor-health telemetry + fallback selectors + MutationObserver | Prevent silent leaks | `content.js` |
| P0 | Compliance Report v1 (PDF, DPDP-mapped) | The paid artifact | backend (+ worker) |
| P1 | GLiNER entities + embedding/zero-shot sensitivity classifier + calibration | Real detection quality, near-zero cost | `backend/models/*`, `train_classifier.py` |
| P1 | Consolidate risk scoring into one module | Kill duplicated logic | `main.py`, `background.js` |
| P1 | Postgres + Alembic; org scoping; audit log | Multi-tenant readiness | `main.py`, new migrations |
| P1 | Converge dashboards; add dashboard auth | Single source of truth | `dashboard/*`, `popup.js` |
| P1 | Admin policy + onboarding UI | Configurability / self-serve | extension + backend + dashboard |
| P2 | Layer 3 (privacy-safe LLM) for ambiguous band | Contextual differentiator; Business tier | backend |
| Ongoing | Finish SentinelAI→Preflight rename; fix README/design drift | Credibility | `detectors.js`, `background.js`, `README.md`, `design.md` |
| Ongoing | L1 category tests + real FP/FN measurement | Currently PAN-only tested | `test/detectors.test.js`, eval harness |

**Development rules I'll hold to (yours):** never rewrite working code without cause; prefer incremental change; explain the _why_ before the _how_; name affected files before touching them; keep it production-quality and maintainable; every change must move the needle on "a startup would pay monthly."

---

## 11. Open Questions for You (before any code)

1. **Distribution model** (your open GTM decision): self-serve vs white-glove? This determines whether onboarding/policy UI (P1 #12) is urgent or can wait — self-serve needs it early.
2. **Privacy stance on Layer 3:** are you willing to require customers' own LLM keys / a zero-retention provider, and disclose it in a DPA? This decides whether Layer 3 is even sellable to the audit ICP.
3. **Enforcement posture:** are you positioning as advisory/detective (warn + log) or do any target buyers need _hard block_ / network enforcement in the first year? Changes the P3 bet.
4. **The compliance report:** do you have design partners who'll tell us exactly what their auditor wants to see in it? That should shape Report v1, not our guesses.
5. **Data for ML evaluation:** any design partners willing to run an _opt-in, on-device_ labeled eval (no prompt egress) so we can measure real precision/recall instead of synthetic accuracy?

_Nothing in this document has changed any code. It's an assessment and a backlog, per your instruction to audit before building._
