# Preflight.ai — Architecture

## 1. System overview (ASCII)

```
┌─────────────────────────────── Browser (employee machine) ───────────────────────────────┐
│                                                                                             │
│  ┌───────────────────────────────┐         ┌──────────────────────────────────────────┐  │
│  │  AI site page (chatgpt.com,    │         │        Chrome Extension (MV3)             │  │
│  │  claude.ai, gemini, ...)       │         │                                            │  │
│  │                                │  DOM     │  ┌──────────────────────────────────┐    │  │
│  │  composer / send button  ◄─────┼──events──┼──┤ content.js (isolated world)      │    │  │
│  │  file input / drag-drop  ──────┼──────────┼─▶│  - intercepts send (click/Enter/  │    │  │
│  │                                │           │    submit), preventDefault() FIRST │    │  │
│  └───────────────────────────────┘           │  - captures attached files          │    │  │
│                                                │  - runs fileScanner.js (PDF/DOCX/   │    │  │
│                                                │    TXT text extraction)             │    │  │
│                                                │  - runs detectors.js (Layer 1)      │    │  │
│                                                │  - shows warning overlay            │    │  │
│                                                │  - resumes/cancels the send         │    │  │
│                                                └──────────────┬───────────────────────┘    │  │
│                                                                │ chrome.runtime.sendMessage │  │
│                                                ┌───────────────▼───────────────────────┐    │  │
│                                                │ background.js (service worker)        │    │  │
│                                                │  - proxies Layer 2 classify calls     │    │  │
│                                                │  - batches/queues telemetry           │    │  │
│                                                │  - stores dashboard events (chrome.   │    │  │
│                                                │    storage.local)                     │    │  │
│                                                │  - periodic flush alarm               │    │  │
│                                                └──────────────┬─────────────────────────┘    │  │
│                                                                │ fetch()                      │  │
│  ┌───────────────────────────────┐           ┌───────────────▼─────────────────────────┐    │  │
│  │ popup.js / popup.html          │           │  http://localhost:8000                  │    │  │
│  │  - local analytics view        │◄──────────┤  (or hosted backend, same contract)      │    │  │
│  │    (reads chrome.storage.local)│  storage   └───────────────┬─────────────────────────┘    │  │
│  │  - opens dashboard/dist/       │            (network — leaves the browser)                 │  │
│  └───────────────────────────────┘                             │                              │  │
└──────────────────────────────────────────────────────────────┼──────────────────────────────┘  │
                                                                 │
                          ┌──────────────────────────────────────▼───────────────────────────────┐
                          │                    FastAPI backend (backend/)                          │
                          │                                                                        │
                          │  GET  /health                     — liveness                           │
                          │  GET  /config          (auth)     — org plan / feature flags            │
                          │  POST /classify        (auth)     — Layer 2: TF-IDF+LogReg + spaCy NER  │
                          │  POST /api/scan-event             — telemetry ingest → SQLite            │
                          │  GET  /api/dashboard/*             — aggregate reads for admin dashboard  │
                          │                                                                        │
                          │  ┌────────────┐   ┌───────────────┐   ┌────────────────────────────┐  │
                          │  │ auth.py    │   │ models/        │   │ preflight_monitoring.sqlite3│  │
                          │  │ (mock,     │   │ text_classifier│   │ (single `scans` table)      │  │
                          │  │ in-memory  │   │ + ner_model    │   │                              │  │
                          │  │ token map) │   │ (load-at-import)│   │                              │  │
                          │  └────────────┘   └───────────────┘   └────────────────────────────┘  │
                          └────────────────────────────────────────────────────────────────────────┘
                                                                 │
                          ┌──────────────────────────────────────▼───────────────────────────────┐
                          │            dashboard/ — React + Vite + TS admin SPA                    │
                          │  Reads the /api/dashboard/* endpoints; built output loaded by the       │
                          │  extension popup via chrome.tabs.create(chrome.runtime.getURL(...))     │
                          └────────────────────────────────────────────────────────────────────────┘
```

## 2. App flow (end to end)

1. **Compose** — employee types a prompt and/or attaches a PDF/DOCX/TXT file in the AI site's own composer UI.
2. **Intercept** — `content.js` listens at `document`-level (capture phase, so it runs before the site's own React handlers) for click on the send button, Enter keydown in the input box, or a form submit. `preventDefault()`/`stopImmediatePropagation()` fire **synchronously**, before any `await` — this is a hard architectural rule (see `rules.md`), because once an async function yields control, the browser's native dispatch continues and the site's own send handler fires anyway.
3. **Extract** — if files were attached (captured via `change`/`drop`/`paste` listeners into a `pendingAttachments` queue, since some sites clear the underlying `<input type="file">` once "accepted"), `fileScanner.js` extracts plain text from each (pdf.js for PDF, mammoth.js for DOCX, `File.text()` for TXT) and appends it to the typed prompt text. This combined string is the only thing that gets scanned — never the original prompt text alone once attachments exist.
4. **Layer 1 scan** — `detectors.js` (`window.SentinelDetectors.scan()`) runs entirely client-side, synchronously fast, against the combined text.
   - Any finding → show the Layer 1 warning overlay immediately. Stop here.
   - No finding → continue to Layer 2.
5. **Layer 2 scan** — `content.js` messages `background.js` (`PREFLIGHT_LAYER2_CLASSIFY`), which calls `POST /classify` on the FastAPI backend with a 1.5s timeout. The backend runs the TF-IDF+LogisticRegression classifier and spaCy NER, applies a stateless risk-scoring rule, and returns `risk_level` (low/medium/high).
   - `low` or backend unreachable/timeout → **fail open**, resume the send.
   - `medium`/`high` → show the Layer 2 warning overlay.
6. **Employee decision** — Proceed / Cancel (both overlays), or Sanitize (Layer 1 overlay only — rewrites the typed text with synthetic safe values; cannot rewrite inside an attached file, so a flagged attachment must be manually removed).
7. **Resume or drop** — Proceed re-triggers the native send (button click or synthesized Enter) with our interception bypassed for that exact approved payload. Cancel simply leaves the composer untouched.
8. **Telemetry** — every branch above calls `logEvent()`, which strips raw prompt/file content down to a ≤80-char preview + length, and messages `background.js` (`SENTINEL_LOG_EVENT`). Background stores it locally (`chrome.storage.local.dashboardEvents`, capped at 500) and POSTs it to `/api/scan-event`, queuing on failure for retry via a `chrome.alarms` flush every 2 minutes.
9. **Post-send confirmation** — a `MutationObserver` on the response container logs a `response_received` event once the AI's reply appears, as a lightweight signal the message actually went out.
10. **Dashboard / report** — the FastAPI backend's `/api/dashboard/*` endpoints aggregate the SQLite `scans` table for the popup's local view and the standalone React dashboard; a compliance report is generated from the same data (not yet automated — see `Phases.md`).

## 3. Folder & file structure

```
preflight-ai-extension-fixed/
├── manifest.json                 # MV3 manifest — permissions, content_scripts, web_accessible_resources
├── icons/                        # 16/48/128px extension icons
│
├── src/                          # Chrome extension source (loaded directly, no build step)
│   ├── background.js             # Service worker: Layer 2 proxy, telemetry batching, storage, alarms
│   ├── content.js                # Send interception, scan orchestration, warning overlays, logging
│   ├── detectors.js               # Layer 1 regex engine — window.SentinelDetectors
│   ├── fileScanner.js            # PDF/DOCX/TXT text extraction — window.PreflightFileScanner
│   ├── warning.css               # Overlay/modal styling (scoped via `sentinel-` prefix)
│   ├── popup.html / popup.js     # Toolbar popup — local analytics view + CSV/JSON export
│   ├── services/
│   │   └── telemetryReporter.js  # sendTelemetry() — POST to /api/scan-event
│   └── vendor/                   # Vendored third-party parsing libs (no CDN dependency at runtime)
│       ├── pdf.min.js / pdf.worker.min.js     # pdf.js (Apache-2.0)
│       └── mammoth.browser.min.js             # mammoth.js (BSD)
│
├── backend/                      # FastAPI Layer 2 service (Python)
│   ├── main.py                   # All endpoints, Pydantic schemas, SQLite persistence, risk scoring
│   ├── auth.py                   # Mock in-memory token→org resolver, plan-tier gating
│   ├── requirements.txt
│   ├── models/
│   │   ├── text_classifier.py    # TF-IDF + LogisticRegression inference wrapper (loads at import)
│   │   ├── ner_model.py          # spaCy + EntityRuler, regex fallback
│   │   └── train_classifier.py   # Offline training script (synthetic Indian-context data)
│   ├── data/training_data.csv    # Generated by train_classifier.py
│   ├── saved_models/text_classifier.joblib
│   ├── tests/test_classifier.py
│   └── preflight_monitoring.sqlite3   # Runtime telemetry DB (single `scans` table)
│
├── dashboard/                    # React + Vite + TypeScript admin SPA
│   ├── src/                      # Components, charts (recharts), Tailwind styling
│   └── dist/                     # Built output, loaded by the extension popup
│
├── test/detectors.test.js        # Plain-Node regression tests for Layer 1 detectors
├── .kiro/specs/preflight-layer2-backend/   # Layer 2 design.md + requirements.md (source spec)
│
├── PRD.md / architecture.md / rules.md / Phases.md / design.md / memory.md   # This doc set
├── MASTER_ROADMAP.md             # 29-milestone engineering execution plan
├── PRODUCT_AUDIT.md              # Independent technical/product/security audit
└── README.md
```

## 4. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Extension | Chrome Manifest V3, vanilla JS (no framework, no bundler) | Content scripts loaded directly by the manifest; no TypeScript, no build step |
| Document parsing | pdf.js 3.11 (vendored), mammoth.js 1.7 (vendored) | Loaded as regular content scripts (isolated world), not dynamically injected |
| Backend | FastAPI 0.111, Python 3.11, Pydantic v2 | Single-process, models loaded once at startup (`lifespan`) |
| ML — classification | scikit-learn 1.4 (TF-IDF + Logistic Regression) | 7 fixed categories, trained offline on synthetic data |
| ML — NER | spaCy 3.7 (`en_core_web_sm`) + custom `EntityRuler`, regex fallback | Never raises; reports which backend served the request |
| Storage | SQLite (raw `sqlite3` module, no ORM) | Single `scans` table, ad hoc `ALTER TABLE` migrations |
| Admin dashboard | React 18, Vite 6, TypeScript 5.6, Tailwind 3.4, recharts | Static build served from within the extension bundle |
| Testing | pytest 8.2 (backend), plain Node script (`test/detectors.test.js`) | No FastAPI endpoint tests exist yet |
| Billing (planned, not built) | Razorpay Subscriptions | Chosen for GST invoicing compatibility |
| Build/dev tooling used to produce code | Kiro (AWS agentic IDE) for implementation; Claude for architecture/spec/review | Per `Preflight_ai_Project_Documentation.md` |

## 5. Data flow contracts

See `.kiro/specs/preflight-layer2-backend/design.md` and `requirements.md` for the authoritative Layer 2 API contract (request/response shapes, error codes, the 24 correctness properties). At a glance:

- `POST /classify` — `{text: 1-20000 chars}` → `{content_type, confidence, all_scores, entities[], risk_level, layer3_would_trigger, ner_backend, latency_ms}`. Auth via `Authorization: Bearer <token>`; 403 if the org's plan doesn't include Layer 2.
- `POST /api/scan-event` — telemetry write, unauthenticated today (flagged in `rules.md`/`PRODUCT_AUDIT.md` as something to fix, not a design choice to repeat).
- `GET /api/dashboard/*` — read-only aggregates over the `scans` table, unauthenticated today (same flag).

## 6. Known architectural constraints (carry these into any new feature work)

1. **Extension → backend is the only network egress point.** Content scripts never call the backend directly; everything routes through `background.js`. Keep this invariant — it's what keeps host-permission scope minimal on the AI-site content scripts.
2. **Isolated-world limitation.** A content script cannot see a page's own JS state — only what native DOM events (`change`, `drop`, `paste`, `submit`) expose. If a site attaches files via the File System Access API instead of a real `<input type="file">`, we cannot observe or extract that file. This is a hard platform limitation, not something to work around with cleverness — document it plainly if hit again.
3. **Fail open, never fail closed.** Every point where Layer 2 is unreachable, times out, or errors must let the send through rather than block it. This is a deliberate trust decision (see `rules.md`) — do not change it without a product decision.
4. **No raw prompt/file content ever persisted or logged.** Telemetry carries only a ≤80-char preview, length, and structural metadata (finding types, risk levels, counts). This is currently *violated* in practice per `PRODUCT_AUDIT.md` (input_preview leaking real fragments to an unauthenticated dashboard) — treat this as the top-priority bug, not a pattern to extend.
