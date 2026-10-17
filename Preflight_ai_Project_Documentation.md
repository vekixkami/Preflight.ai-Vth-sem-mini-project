# CLEARANCE BEFORE YOU SEND.

# Preflight.ai

Project Documentation — Product, Architecture & Roadmap

DPDP-aligned prompt DLP for Indian startups | July 2026


## 01 Executive Summary

Preflight.ai is a browser-based data-loss-prevention (DLP) layer purpose-built for Indian startups that use public LLMs — ChatGPT, Claude, Gemini and similar tools — in their daily workflow. It intercepts an employee's prompt before it leaves the browser, detects sensitive or regulated data inside it, warns the employee with a plain-language explanation, and logs the decision for compliance evidence. The product does two things most "AI usage monitoring" tools don't: it explains why something is risky in DPDP terms, and it offers a corrected, safe-to-send version of the prompt rather than simply blocking it — hence the name and tagline.

The company targets small-to-mid Indian startups (25–300 employees) that are mid-way through a SOC 2 or ISO 27001 audit, or fielding enterprise security questionnaires, and need to demonstrate responsible AI usage quickly and cheaply. The sharpest buying signal identified to date is companies already paying for compliance automation tools such as Sprinto or Scrut Automation — they have budget, urgency, and an audit deadline, which removes most of the friction a student-led security vendor would otherwise face.

| Snapshot | Detail |   |   |
| --- | --- | --- | --- |
| Detection architecture | 3 layers: regex | ML classifier | LLM reasoning (Layer 3 planned) |
| Compliance hook | India's Digital Personal Data Protection (DPDP) Act — rules notified Nov 2025, |   |   |
|   | enforcement from May 2027 |   |   |
| Pricing | ■8,000 – ■60,000 / month, tiered by headcount and detection depth |   |   |
| Current build status | Layer 1 built & stress-tested · Layer 2 specced and in implementation · Layer 3 not |   |   |
|   | yet specced |   |   |
| Core structural risk | A Chrome extension is bypassable without an MDM / managed-device policy — |   |   |
|   | acknowledged and tracked |   |   |

IMPORTANT NUANCE — The DPDP framing used throughout this document is a positioning choice, not a literal legal requirement — no clause in the current DPDP rules explicitly mandates AI-prompt-level DLP. Preflight.ai maps its detections to the data categories and obligations DPDP does define, which is defensible and useful for audits, but this distinction should be kept clear in any external claims made to customers or regulators.


## 02 Problem & Market

## 2.1 The problem

Employees at Indian startups routinely paste contracts, customer PII, source code, financial data and internal strategy documents into public LLM chat interfaces to get faster answers. None of that data is recoverable once sent, and most companies have no visibility into what left the building. For companies going through SOC 2 or ISO 27001 certification — or trying to comply with the DPDP Act — this is an unmanaged, undocumented data flow that auditors and enterprise customers increasingly ask about directly.

## 2.2 Target market

- Company size: 25–300 employees — large enough to have real audit exposure, small enough that enterprise DLP suites (Microsoft Purview, Netskope, etc.) are unaffordable or overkill.

- Buying trigger: actively mid-SOC 2 / ISO 27001 audit, or responding to an enterprise security questionnaire that asks about AI tool usage.

- Sharpest ICP signal: customers already paying for compliance automation platforms such as Sprinto or Scrut Automation — they have both budget and urgency.

ICP DISCIPLINE — "Any small Indian startup" is too broad a target. The only segment where a ■8,000/month purchase is genuinely low-friction is companies actively inside a compliance audit — everyone else requires a much longer, harder sell.

## 2.3 Regulatory context — DPDP Act

India's Digital Personal Data Protection Act rules were notified in November 2025, with hard enforcement beginning May 2027. That eighteen-month runway is Preflight.ai's market-timing window: companies have visibility into the deadline but limited existing tooling to prepare for it. Preflight.ai's compliance report output is designed to be usable as evidence of "controls in place" during a regulator audit or an enterprise vendor review.


## 03 Product Overview

Preflight.ai sits as a Chrome extension (Manifest V3) between the employee and the LLM chat window. It is built around a three-layer detection pipeline that escalates from instant local pattern-matching to cloud-based ML classification to LLM-based contextual reasoning, only calling out to more expensive layers when the cheaper layers are uncertain.

## 3.1 Three-layer detection pipeline

*Figure 1 — Detection pipeline: Layer 1 (rule-based) Layer 2 (ML classifier) Layer 3 (LLM reasoning) risk score and action.*

| Layer | What it does | Status |
| --- | --- | --- |
| Layer 1 — | Regex / pattern matching for Aadhaar (Verhoeff checksum), PAN, GST, | Built & stres |
| Rule-based | phone numbers, emails, API keys, AWS credentials, JWT tokens, DB | s-tested |
|   | connection strings, private keys and company-configured keywords. Runs |   |
|   | instantly, fully client-side, zero ML dependency. |   |
| Layer 2 — ML | FastAPI backend running two sub-models: a TF-IDF + Logistic Regression | Specced; i |
| classifier | document classifier across 7 categories (contract, financial report, HR doc, | mplementat |
|   | source code, strategy doc, customer data, general), and a spaCy NER model | ion |
|   | augmented with Indian business entities, with graceful fallback. UPI | underway |
|   | detection is deferred here from Layer 1. |   |


| Layer | What it does | Status |
| --- | --- | --- |
| Layer 3 — LLM | Contextual reasoning that fires only when Layers 1 and 2 are uncertain — | Not yet |
| reasoning | e.g. recognising that a prompt reveals a client identity plus a business | specced |
|   | relationship, which triggers a DPDP Section 8 style risk flag even though no |   |
|   | single field matched a pattern. |   |

## 3.2 End-to-end workflow

The interception happens synchronously, in the moment between the employee clicking "Send" and the prompt actually leaving the browser. If Layer 1 is confident, a warning is shown immediately; if it is uncertain, the extension calls the backend for Layer 2/3 evaluation before deciding. Every outcome — cancelled or sent anyway — is logged for the audit trail.


*Figure 2 — End-to-end flow from employee keystroke to logged, audit-ready event.*


## 3.3 What each stakeholder sees

The same detection event produces three different views, matched to three different audiences inside a customer organisation — the employee who needs to correct their behaviour in the moment, the IT/compliance team who needs operational visibility, and legal/management who need audit-ready evidence.

*Figure 3 — Detection pipeline output, split by audience: employee warning, admin dashboard, compliance report.*

| Audience | What they get |
| --- | --- |
| Employee (real-time warning) | In-browser inline popup with a plain-language reason, the specific data flagged, |
|   | the relevant DPDP section, and two buttons — proceed anyway or cancel send. |
|   | Both choices are logged. There is no hard block at the MVP stage. |
| Admin / IT & compliance | Per-employee risk score, total violations this week, which AI tools are in use, |
|   | which data categories are being flagged, proceed-vs-cancel breakdown, a |
|   | high-risk employee list, and real-time alerts on critical violations. |
| Legal / management | An auto-generated monthly compliance report: total violations and trend, DPDP |
|   | sections triggered, proof of controls in place, an incident log with timestamps, |
|   | employee consent records, and a PDF export usable in a regulator audit. |


## 04 Pricing & Packaging

Pricing tiers map directly to detection depth — a customer only pays for the layers of the pipeline they need, which keeps the entry tier affordable for the audit-driven ICP while creating a natural upgrade path as headcount and risk surface grow.

| Tier | Price | Company size | Detection scope |
| --- | --- | --- | --- |
| Starter | ■8,000 / month | Up to 25 employees | Layer 1 only (rule-based detection) |
| Growth | ■25,000 / month | 25–100 employees | Adds Layer 2 (ML classifier) |
| Business | ■60,000 / month | 100–300 employees | Adds Layer 3 (LLM reasoning) |

Billing is planned on Razorpay Subscriptions, chosen over ExtensionPay and Dodo Payments specifically for GST invoicing compatibility with Indian business customers.


## 05 Technical Status

## 5.1 Stack

| Component | Detail |
| --- | --- |
| Browser extension | Chrome Extension, Manifest V3 |
| ML backend | FastAPI (Python), scikit-learn (TF-IDF + Logistic Regression), spaCy (NER) |
| Implementation tooling | Kiro (AWS agentic IDE) for build execution; Claude used for architecture, spec |
|   | generation, code review and strategic assessment |
| Billing (planned) | Razorpay Subscriptions |

## 5.2 What's built

Layer 1 (regex-based detection) — built and stress-tested. Key bugs found and fixed during hardening:

- An async race condition where preventDefault() was being called before an await resolved.

- A stale DOM node reference, resolved by moving to document-level event delegation using closest().

- PAN regex missing a case-insensitive flag.

- Phone regex failing on parenthesized country-code formats.

- OPENAI_KEY_REGEX not matching the modern sk-proj-... key format.

UPI ID detection was intentionally deferred to Layer 2 rather than handled in regex.

Layer 2 (ML backend) — designed and specced. A working backend was produced and packaged as a deliverable, then handed to Kiro for implementation; Kiro's resulting high-level design was reviewed against the spec and confirmed strong alignment.

## 5.3 Known open issues

- Telemetry tracking broken: the decision and action_taken fields are logging null despite the warning modal's buttons existing and being wired up.

- High latency: ~3.5 seconds average for regex-only detection — most likely because the warning modal is gated on a synchronous telemetry POST rather than firing immediately from local detection.

- No detector diversity in test data: every logged scan so far has been PAN-only; other categories are untested in the live pipeline.

- Dashboard needs significant fixes — acknowledged, but deliberately not the current priority.

## 5.4 Codebase structure

background.js, content.js, detectors.js, popup.html, popup.js, warning.css, manifest.json. Internal classes still reference the product's prior codename, SentinelDetectors — rebranding to Preflight.ai naming is still pending in the code, not just the product surface.


## 06 Roadmap

Near-term priorities, roughly in the order they block go-to-market execution:

| # | Item | Why it matters | Status |
| --- | --- | --- | --- |
| 1 | Fix telemetry & dashboard | Decision/action logging is broken; dashboard has | In progress |
|   | bugs | known, deferred issues |   |
| 2 | Spec Layer 3 (LLM | Contextual detection for cases only an LLM can catch | Not started |
|   | reasoning) |   |   |
| 3 | Execute go-to-market | LinkedIn lead-gen strategy is defined but not yet | Not started |
|   |   | executed |   |
| 4 | Resolve distribution model | Self-serve vs. white-glove — affects how much | Open decision |
|   |   | plan-switching UX needs early build priority |   |
| 5 | Access-control backend | Org-level licensing, seat allocation, plan-gated feature | Not started |
|   |   | flags, server-side seat limits |   |


## 07 Go-to-Market Strategy

## 7.1 Lead generation approach

- Company signal over people search: LinkedIn job postings filtering for "SOC 2 OR ISO 27001 OR DPDP" are a higher-signal indicator of an in-market buyer than searching for individual people.

- Compliance community as lead pool: Sprinto and Scrut Automation LinkedIn comment sections surface the exact ICP publicly announcing their compliance milestones — a live, low-cost lead source.

- Primary channel: LinkedIn Sales Navigator (currently on free trial).

## 7.2 Open distribution question

Whether Preflight.ai sells self-serve or white-glove is still an open decision, and it materially changes engineering priority — a self-serve motion needs polished plan-switching and onboarding UX much earlier than a white-glove motion would.


## 08 Key Risks & Structural Considerations

## Enforcement boundary

A Chrome extension is trivially bypassable by an employee without an accompanying MDM / managed-device policy enforcing it. This is an acknowledged structural limitation of the product category, not a bug — it should be addressed explicitly in customer conversations rather than implied away.

## Commoditization risk

Microsoft Purview and major AI vendors shipping similar prompt-warning features as free built-ins is a legitimate, trackable threat to the category, not a hypothetical one.

## Trust gap

White-glove security sales from a student-led vendor faces a structural credibility challenge with security-conscious buyers, and needs deliberate mitigation — audit-style transparency, references, and the compliance-report output itself all help close this gap.

## Regulatory framing risk

The DPDP tie-in is a strong positioning choice but not a literal current requirement — over-claiming regulatory mandate in sales or marketing materials would be a credibility and legal risk.


## 09 Appendix

## A. Document scope & sources

This document consolidates the product architecture, current build status and go-to-market thinking for Preflight.ai as of July 2026. Figures 1–3 are the working architecture diagrams used internally to design the detection pipeline and are reproduced here as-is. Figures and status reflect the most recent build and planning conversations at time of writing; open items in Sections 5 and 6 are expected to change as development continues.

## B. Glossary

| Term | Definition |
| --- | --- |
| DPDP Act | India's Digital Personal Data Protection Act — rules notified November 2025, enforcement from |
|   | May 2027. |
| DLP | Data Loss Prevention — technology that detects and prevents sensitive data from leaving an |
|   | organisation's control. |
| ICP | Ideal Customer Profile. |
| NER | Named Entity Recognition — an ML technique for identifying structured entities (names, IDs, |
|   | organisations) in free text. |
| MDM | Mobile Device Management — enterprise software used to enforce device-level policy, relevant |
|   | to closing the extension's enforcement gap. |
