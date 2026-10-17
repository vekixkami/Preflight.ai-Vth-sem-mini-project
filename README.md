# Preflight.ai — Clearance before you send

Chrome extension that detects sensitive company data (Indian PII, credentials,
internal documents, company keywords) in prompts and attachments **before** an
employee sends them to ChatGPT, Claude, Gemini, Copilot or Perplexity. It warns
first and offers to replace the sensitive parts with safe placeholders.

## How it works

1. **Layer 1 — rules (in the browser).** `src/detectors.js`: Aadhaar, PAN, GSTIN,
   IFSC, bank accounts, phone, email, OpenAI/Anthropic/AWS keys, JWTs, database
   URLs, private keys, passwords, `.env` values, risky file names, pasted source
   code and company keywords. Instant, no network.
2. **Layer 2 — ML classifier (your backend).** If Layer 1 is clean, the text is
   classified as contract / financial / HR / source code / strategy / customer
   data / general. Medium and high risk show a softer warning. If the backend is
   unreachable or slow, the send goes through (fail open).
3. **Attachments.** PDF, DOCX and TXT files are read locally
   (`src/fileScanner.js`) and scanned with the same pipeline.
4. **Privacy.** Raw prompts, previews, matched values and chat titles are never
   stored or transmitted. Telemetry is limited to detection types, severity, the
   employee's decision (sent anyway / cancelled / sanitized / allowed) and timing.

## Setup

### 1. Backend

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm        # optional: better entity extraction
python models/train_classifier.py              # creates saved_models/text_classifier.joblib
cp .env.example .env                           # then edit tokens
uvicorn main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Run `uvicorn` through the venv (`.venv/bin/python -m uvicorn ...`) if you move the
project folder, because a venv records its original path.

Tokens come from `PREFLIGHT_API_TOKENS` (`token:org_id:plan`). Without it, and
outside `PREFLIGHT_ENV=production`, local development tokens from `backend/auth.py`
are used. Every endpoint except `/health` requires `Authorization: Bearer <token>`,
and telemetry/dashboard data is scoped to the token's organisation.

### 2. Extension

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
   this folder (the one containing `manifest.json`).
2. The Settings page opens on first install: enter the backend URL, an API token,
   and (optionally) company keywords, then press **Test connection**.
3. Open ChatGPT/Claude and type a fake PAN such as `ABCDE1234F`, then press Enter.

Reload the extension (and refresh the AI tab) after changing any file in `src/`.

### 3. Dashboard

The popup's **Open Dashboard** button opens the bundled build and reuses the
extension's backend URL and token. To rebuild or develop it:

```bash
cd dashboard && npm install
npm run build        # outputs dashboard/dist (loaded by the extension)
npm run dev          # standalone on http://localhost:3000 (asks for URL + token)
```

## Tests

```bash
node test/detectors.test.js      # Layer 1 rules
node test/background.test.js     # service worker (mocked chrome API)
cd backend && python -m pytest   # classifier, API auth, privacy, org isolation
```

## Known limitations

- Selectors for each AI site live in `SELECTORS` in `src/content.js`; the ChatGPT
  entry lists several known composer layouts, and an unknown editor inside a form
  is detected automatically. A site redesign can still break interception, so check
  the console for `[Preflight]` messages first.
- Images and spreadsheets attached to a prompt are not inspected.
- A browser extension can be disabled by the user; this is a safety net, not an
  enforcement boundary.
- Layer 3 (LLM reasoning) is not built; `layer3_would_trigger` is a forward-looking flag.
- Training data is ~350 synthetic examples, so Layer 2 confidence is low and the
  classifier is a coarse signal. Sensitive labels below `PREFLIGHT_MIN_CONFIDENCE`
  (default 0.20) are ignored.
