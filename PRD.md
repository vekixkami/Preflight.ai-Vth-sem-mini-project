# Preflight.ai — Product Requirements Document

## 1. Problem

Employees at Indian startups routinely paste contracts, customer PII, source code, financial data, and internal strategy documents into public LLM chat interfaces (ChatGPT, Claude, Gemini, Copilot, Perplexity) to get faster answers. None of that data is recoverable once sent, and most companies have no visibility into what left the building. For companies going through SOC 2 / ISO 27001 certification, or trying to align with India's DPDP Act, this is an unmanaged, undocumented data flow that auditors and enterprise customers increasingly ask about directly.

## 2. What we're building

Preflight.ai is a browser-based data-loss-prevention (DLP) layer for public LLMs. It:

1. Intercepts an employee's prompt (and any attached document) **before** it leaves the browser.
2. Detects sensitive or regulated data inside it using a three-layer pipeline (regex → ML classifier → LLM reasoning).
3. Warns the employee with a plain-language explanation of *why* it's risky, in DPDP terms where applicable.
4. Offers a corrected, safe-to-send version of the prompt rather than only blocking it (Layer 1), or lets the employee proceed/cancel with the decision logged (Layer 2+).
5. Logs every decision (proceed / cancel / sanitize) for audit evidence, surfaced via an admin dashboard and a compliance report.

It does **not** attempt to be a network-level DLP or MDM-enforced control — it is a Chrome extension, and bypass by a determined employee (disabling it, using another browser) is an acknowledged structural limitation of this product category, not a bug to "fix" at the extension layer.

## 3. Target users

### 3.1 Company / buyer profile (ICP)

- **Size:** 25–300 employees. Large enough to have real audit exposure; small enough that enterprise DLP suites (Microsoft Purview, Netskope) are unaffordable or overkill.
- **Buying trigger:** actively mid-SOC 2 / ISO 27001 audit, or responding to an enterprise security questionnaire that asks about AI tool usage.
- **Sharpest signal:** companies already paying for compliance automation platforms (Sprinto, Scrut Automation) — they have both budget and urgency.
- **Explicitly out of scope as a target:** "any small Indian startup." Too broad; a ₹8,000/month purchase is only low-friction for a company already inside a compliance process.

### 3.2 In-product user roles

| Role | What they need from Preflight |
|---|---|
| **Employee** | A fast, non-punitive in-browser nudge: what was flagged, why, and an easy way to either fix it or proceed. Must not meaningfully slow down their workflow. |
| **IT / Compliance admin** | Visibility into who is using which AI tools, what data categories are being flagged, proceed-vs-cancel rates, and real-time alerts on critical violations. |
| **Legal / management** | Audit-ready evidence: a monthly compliance report mapping detections to DPDP obligations, usable in a regulator audit or enterprise vendor review. |

## 4. Core features

### 4.1 Detection pipeline (see `architecture.md` for implementation detail)

- **Layer 1 — Rule-based (built):** regex/pattern matching for Aadhaar, PAN, GST, IFSC, bank accounts, phone numbers, emails, cloud/API credentials (OpenAI, Anthropic, AWS keys, JWTs, DB connection strings, private keys), hardcoded passwords, and company-configured keyword lists. Runs entirely client-side, instantly, with zero ML dependency.
- **Layer 2 — ML classifier (implemented, pilot-grade):** a FastAPI backend running a TF-IDF + Logistic Regression document-type classifier (contract, financial report, HR doc, source code, strategy doc, customer data, general) plus a spaCy NER model tuned for Indian business entities, with a stateless risk-scoring policy on top.
- **Layer 3 — LLM contextual reasoning (not built):** intended to catch cases where no single field trips a pattern but the combination is risky (e.g., "this reveals a client identity + a business relationship" — a DPDP Section 8–style risk). Currently only exists as a plan/flag in the API contract (`layer3_would_trigger`), with no actual model behind it.

### 4.2 Document scanning

Attached PDF, DOCX, and TXT files are text-extracted client-side and fed into the same Layer 1/Layer 2 pipeline as typed prompt text before a send is allowed through — no separate detection logic, no separate warning UI.

### 4.3 Warning & remediation UI

- In-page modal (not a block) shown before the prompt leaves the browser.
- Shows risk level, category breakdown, and (for Layer 1) a "Replace with Safe Data" option that substitutes flagged values with synthetic placeholders and lets the employee send the sanitized version.
- Every outcome (sanitize / proceed / cancel) is logged — there is no silent bypass path.

### 4.4 Admin dashboard

- Per-employee risk score, total violations, which AI tools are in use, which data categories are flagged, proceed-vs-cancel breakdown, high-risk employee list, real-time alert on critical violations.

### 4.5 Compliance report

- Auto-generated monthly report: total violations + trend, DPDP sections triggered, proof of controls in place, incident log with timestamps, employee consent record, exportable as PDF for a regulator audit or enterprise vendor review.

### 4.6 Pricing tiers (feature-gated by plan, enforced server-side)

| Tier | Price | Company size | Detection scope |
|---|---|---|---|
| Starter | ₹8,000/mo | Up to 25 employees | Layer 1 only |
| Growth | ₹25,000/mo | 25–100 employees | + Layer 2 |
| Business | ₹60,000/mo | 100–300 employees | + Layer 3 |

**Known inconsistency to resolve before this ships as marketing copy:** Business tier is currently sold on "Layer 3," which does not exist yet. Charging for an unbuilt tier is a trust and potential contractual risk — this must be resolved (build Layer 3, or reprice/rescope Business) before external pricing claims go out. See `PRODUCT_AUDIT.md`.

## 5. Non-goals (explicitly out of scope for now)

- Hard-blocking sends (MVP is warn + log, not block).
- Enforcing via MDM / managed device policy (acknowledged bypass surface, not solved at this layer).
- Supporting AI tools beyond the listed 8 host permissions.
- Real-time collaboration / multi-seat editing of the extension's own settings.
- Self-serve billing UI (Razorpay Subscriptions integration is planned, not built).
- On-device zero-egress model, SSO/SCIM, SIEM webhooks — all explicitly deferred to P2/P3 per `MASTER_ROADMAP.md`.

## 6. Success criteria (product-level, not engineering)

- An admin can, without engineering help, answer "what sensitive data did my company send to ChatGPT last month, and can I prove we have controls in place?"
- An employee is warned within a workflow-acceptable latency (target: local Layer 1 result in well under a second — see `PRODUCT_AUDIT.md`'s ~3.5s latency finding, currently unmet).
- A compliance report generated by Preflight is something a SOC 2 auditor or enterprise security questionnaire would actually accept as evidence.

## 7. Key open product questions

1. **Self-serve vs. white-glove distribution** — unresolved, and it materially changes engineering priority (self-serve needs polished plan-switching/onboarding UX much earlier).
2. **Regulatory framing** — the DPDP tie-in is a positioning choice, not a literal current legal requirement. Sales/marketing must not over-claim a regulatory mandate that doesn't exist in the current DPDP rules text.
3. **Layer 3 timeline** — must be resolved before Business-tier pricing is defensible externally.
