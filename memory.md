# Preflight.ai — Memory (for transferring context between AI chat sessions)

Purpose: paste this file (or point an AI assistant at it) at the start of a new chat so it doesn't have to re-derive the whole codebase from scratch. Update it whenever a session produces a real decision, fix, or newly-discovered fact — not after every message.

**Last updated:** 2026-09-11 (session covering: full codebase onboarding, document-scanning feature, a live bug investigation, and this doc set).

---

## 1. What this project is

Preflight.ai — a Chrome extension (MV3) that intercepts prompts (and now attached documents) typed into ChatGPT/Claude/Gemini/Copilot/Perplexity, scans them with a 3-layer detection pipeline (regex → ML classifier → LLM reasoning, Layer 3 not built), warns the employee before the message leaves the browser, and logs the decision for a compliance dashboard/report. Full detail: `PRD.md`, `architecture.md`.

**Not a git repository.** No `.git` directory exists anywhere in this tree as of this writing — there is no commit history, no branches. If a future session runs `git log` expecting history, it will fail; that's expected, not a broken environment.

## 2. Repo layout (see `architecture.md` §3 for full detail)

- `manifest.json` + `src/` — the extension itself (vanilla JS, no build step, no bundler).
- `backend/` — FastAPI Layer 2 service (`main.py`, `auth.py`, `models/`), SQLite storage.
- `dashboard/` — React/Vite/TS admin SPA, built output loaded by the extension popup.
- `.kiro/specs/preflight-layer2-backend/` — the authoritative Layer 2 API spec (design.md + requirements.md).
- `MASTER_ROADMAP.md`, `PRODUCT_AUDIT.md` — pre-existing, human-authored planning/audit docs. **Read these before proposing priorities** — they already contain a reviewed, prioritized punch list; don't rediscover it and present it as new.
- `PRD.md`, `architecture.md`, `rules.md`, `Phases.md`, `design.md`, this file — written this session, consolidating everything above into a working doc set.

## 3. Known bugs / gaps (verified by reading code, not just docs)

1. **Privacy violation (top priority, per `PRODUCT_AUDIT.md`):** `input_preview` (≤80/240 chars of real prompt text) flows from `content.js` → `background.js` → `POST /api/scan-event` → SQLite (`preflight_monitoring.sqlite3`, a live file sitting in the repo) → an **unauthenticated** dashboard. This directly contradicts the Layer 2 spec's "SHALL NOT write prompt content to disk" requirement.
2. **`decision`/`action_taken` always log as `null`.** Root cause (confirmed by reading code, not guessed): `content.js`'s `logEvent()` only ever sets an `action` field (`"proceeded"`, `"cancelled"`, etc.); `background.js`'s `normalizeDashboardEvent()`/`telemetryPayloadFromLog()` and `popup.js` both read `payload.decision`/`payload.action_taken`, which never exist in the payload. It's a field-name mismatch between producer and consumer, not a broken button handler. **Not yet fixed** — flagged, not patched, since the user hasn't asked for this fix yet.
3. **~3.5s latency claim (from docs) doesn't fully match the current code.** The docs blame a synchronous telemetry POST gating the modal, but `content.js` actually fires `logEvent()` without awaiting it before showing the modal. The more likely real culprit still on the critical path: `await getCompanyKeywords()` inside `SentinelDetectors.scan()` (a `chrome.storage.local` round-trip). **Not yet fixed.**
4. **CORS wide open** (`allow_origins=["*"]`) on the FastAPI backend, and `/api/scan-event` + all `/api/dashboard/*` endpoints have **no auth** at all (only `/config` and `/classify` check a bearer token). Explicit TODO comment in `main.py` acknowledges this.
5. **Dead code:** `BUSINESS_LAYER2_TYPES` (main.py, unused), `AWS_SECRET_REGEX` and the full Verhoeff Aadhaar checksum implementation (`detectors.js`, defined but never called — Aadhaar detection actually just uses a looser `isPlausibleAadhaar()` heuristic), `authToken`-gated code paths in `background.js` (nothing in this codebase ever sets `authToken`, so the `api.sentinelai.app` fetches are permanently dormant).
6. **Old codename "SentinelAI" still live in code** (`window.SentinelDetectors`, `SENTINEL_LOG_EVENT`, `sentinel-flush-queue` alarm, the dead `api.sentinelai.app` host) alongside the "Preflight.ai" branding everywhere else. Rename pass is a known, deliberately-deferred task (`Phases.md` Phase 5).
7. **README.md contradicts reality.** It claims "no backend dependency," "Layer 2 not yet built," "no admin dashboard," "events never actually sent anywhere" — all false as of this codebase's actual state. Needs a rewrite, not yet done.
8. **Hardcoded pilot bearer token shipped in extension source:** `background.js` has `TOKEN: "tok_growth_bravo"` hardcoded, matching one of `auth.py`'s 3 mock tokens. Fine for a pilot, not for anything beyond it.

## 4. Work completed this session

1. **Full codebase onboarding** (see `MEMORY.md`-adjacent context in prior chat turns — not repeated here, this file supersedes ad hoc summaries).
2. **Document scanning feature implemented** — PDF/DOCX/TXT attachments are now text-extracted client-side and fed into the *same* Layer 1/Layer 2 pipeline used for typed text, before a send is allowed through.
   - New: `src/fileScanner.js` (extraction logic, `window.PreflightFileScanner`), `src/vendor/pdf.min.js` + `pdf.worker.min.js` (pdf.js 3.11.174, Apache-2.0), `src/vendor/mammoth.browser.min.js` (mammoth 1.7.2, BSD) — all vendored locally, not CDN-loaded at runtime.
   - Changed: `manifest.json` (vendor scripts added to the content-script bundle; `pdf.worker.min.js` added as a `web_accessible_resource`), `src/content.js` (`pendingAttachments` queue populated from `change`/`drop`/`paste` DOM events; `buildScanText()` appends extracted attachment text to the typed prompt before `SentinelDetectors.scan()` and `classifyWithLayer2()` run; `attachmentCount` added to telemetry payloads; `pendingAttachments` cleared only on paths that actually let a send through).
   - **Real bug found and fixed mid-session:** the initial implementation only listened for files via `change` (file-picker) and `drop` events — it never captured `event.clipboardData.files` on `paste`, so a pasted (Cmd+V) file was silently invisible to the extension. Fixed by extending the `paste` listener to call `addAttachments(event.clipboardData.files)`.
3. **Live test surfaced a real-world miss:** user attached a resume PDF to ChatGPT and got no warning at all. Two live hypotheses, not yet resolved:
   - (a) The paste-capture gap above (most likely, now fixed — **awaiting user retest + console log confirmation**, not yet verified).
   - (b) ChatGPT may attach files via the File System Access API (`showOpenFilePicker()`) rather than a real `<input type="file">`, in which case **no DOM event fires at all** and an isolated-world content script structurally cannot observe or extract the file — this would require a fundamentally different interception approach (e.g., hooking the network request itself via `declarativeNetRequest`/`webRequest`), not a DOM-event fix. **Not yet confirmed either way** — needs the user's console log output (`[Preflight] intercepted send...` line present or absent) to distinguish (a) from (b).
   - Also flagged, separately: even with perfect file capture, a resume with no phone/email/Aadhaar-shaped content and no fit in the 7 Layer 2 categories would legitimately score `general`/low-risk today. That's a detection-scope gap (`Phases.md` Phase 2), not an interception bug — don't conflate the two if revisiting this.
4. **This doc set** (`PRD.md`, `architecture.md`, `rules.md`, `Phases.md`, `design.md`, this file) written to consolidate everything above.

## 5. Standing instructions from the user (apply across sessions)

- Understand fully before acting; don't jump to code changes on request.
- **Smallest, cleanest possible change** — stated explicitly for the document-scanning feature, treat as a general default.
- Reuse the existing pipeline (scan → warning → telemetry); never fork a parallel path for a new input type or feature.
- Don't produce speculative "everything is done" reports — verify claims (ask for console output, actual test results) rather than asserting success based on code alone, especially for browser-extension behavior that can't be executed in this environment.
- When studying an external reference repo for ideas, integrate cleanly into this architecture rather than copying its structure/dependencies verbatim (was explicit for the PII-anonymizer reference; treat as a standing preference for any future reference-repo study).

## 6. Open threads for the next session to pick up

1. Awaiting user's console log output to confirm whether the paste-capture fix resolved the silent-resume-PDF issue, or whether ChatGPT's attach flow needs a File System Access API-aware approach instead.
2. `decision`/`action_taken` null bug — diagnosed, not fixed. Fix is: either rename `action` → `decision`/`action_taken` in `logEvent()`'s payload, or update `normalizeDashboardEvent()`/`telemetryPayloadFromLog()` in `background.js` to derive `decision` from `payload.action`. Needs a product decision on which field name is canonical before touching it.
3. Phase 0 (trust/privacy remediation) items are all still open — none have been started, only documented.
