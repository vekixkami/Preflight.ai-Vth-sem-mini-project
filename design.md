# Preflight.ai — Design System

## 0. Current state: three unreconciled palettes

Before prescribing anything, it's worth being honest about what exists today — this is itself a finding, not just context (consistent with `PRODUCT_AUDIT.md`'s "two dashboards disagree" observation):

1. **Warning modal** (`src/warning.css`) — white cards, red/orange risk gradients, `Inter` font.
2. **Popup analytics** (`src/popup.html`) — a teal-accented light theme with its own CSS custom properties, system font stack (no `Inter`).
3. **Admin dashboard** (`dashboard/`) — shadcn/Tailwind HSL-variable convention (`--background`, `--primary`, etc.), values not yet defined to match either of the above.
4. **Marketing/documentation** (`Preflight_ai_Project_Documentation.md` cover, PDF) — dark navy background with an amber/gold accent and the tagline "Clearance before you send."

**Recommendation, not yet executed:** converge on one token set (Section 2) and re-skin the three in-product surfaces to share it. Until that happens, treat this file as the target, and treat the warning modal's existing palette as closest to correct today since it's the most-seen, most-tested surface.

## 1. Brand identity

- **Name:** Preflight.ai
- **Tagline:** "Clearance before you send." — an aviation-preflight-checklist metaphor: you don't stop the flight, you clear it before it happens. Keep this metaphor in mind for iconography and copy tone (checklists, clearance, gates — not walls, locks-only, or "blocked").
- **Tone:** direct, calm, non-punitive. The employee is not being accused of wrongdoing; they're being given information to make a better call in the moment. Avoid alarmist copy beyond what the actual risk level warrants (this is already mostly true in the existing overlay copy — preserve it).

## 2. Color system (target, consolidating the above)

### 2.1 Base / neutral

| Token | Hex | Usage |
|---|---|---|
| `--ink` | `#172033` | Primary text |
| `--muted` | `#647084` | Secondary text, captions |
| `--line` | `#d9dee8` | Borders, dividers |
| `--panel` | `#ffffff` | Cards, modal surface |
| `--surface` | `#f5f7fb` | Page/app background |

(Taken directly from `src/popup.html`'s existing custom properties — reuse these rather than inventing new neutrals.)

### 2.2 Brand / accent

| Token | Hex | Usage |
|---|---|---|
| `--brand-navy` | `#0f172a` | Dark surfaces — marketing, doc covers, dashboard dark mode |
| `--brand-gold` | `#c98a1f` *(approx., match PDF cover accent)* | Primary brand accent — logo mark, links, highlighted stat, "clearance" motif |
| `--accent` | `#0f766e` | In-product primary action accent (teal — matches existing popup) |

### 2.3 Risk / semantic (already established in `warning.css` and `popup.html` — do not redefine differently per surface)

| Level | Hex (gradient start → end) | Used for |
|---|---|---|
| Critical | `#c81e1e → #df1717` | Aadhaar, PAN, GST, API keys, private keys, hardcoded passwords |
| High | `#c2410c → #e44c0b` | JWTs, generic secrets, file references, source code blocks |
| Medium | `#a95c05 → #c97408` | Phone numbers, Layer 2 medium-confidence sensitive content |
| Low | `#374151 → #4b5563` | Email addresses, Layer 2 low-risk/general content |

Solid equivalents (non-gradient contexts — badges, table cells, popup bars): Critical `#991b1b`, High `#c2410c` (`--danger`), Medium `#b45309` (`--warn`), Low/Info `#2563eb` (`--info`), None `#94a3b8`.

**Rule:** a risk level must render as the *same* color family everywhere it appears (modal header, popup bar chart, dashboard badge, exported report). Right now this mostly holds within a single surface but has never been checked cross-surface — verify before shipping the dashboard rebuild in `Phases.md` Phase 3.

### 2.4 Category colors (data classification, from `warning.css` / `popup.html`)

| Category | Color |
|---|---|
| Personal data (Aadhaar, phone, email, bank) | Red family (`#c91c24` active state) |
| Credentials & secrets | Red family, same as personal — currently under-differentiated; consider a distinct hue (e.g., purple) if category-level dashboards need to visually separate these |
| Business data | Green family (`#087c5a`, `#134e4a` for Layer 1 heat cells) |
| Layer 2 flagged | Blue family (`#1e3a8a`, `#dbeafe`) |
| "Hot" / high-severity heatmap cell | Orange (`#7c2d12` on `#fed7aa`) |

## 3. Typography

| Context | Font stack | Notes |
|---|---|---|
| Warning modal (`warning.css`) | `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | Keep — this is the highest-visibility surface (every flagged send) |
| Popup (`popup.html`) | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | No `Inter` — inconsistent with the modal. **Recommend aligning to `Inter` with the same fallback stack** so the extension feels like one product. |
| Dashboard (`dashboard/`) | Not yet explicitly set (Tailwind default / system stack) | Set explicitly to `Inter` when the dashboard rebuild (Phase 3) happens |
| Documentation / marketing | Sans-serif, letter-spaced small caps for eyebrow text ("CLEARANCE BEFORE YOU SEND.") | Keep the eyebrow-caps treatment — it reads as a security/compliance product convention |

### Type scale (as observed in the modal — treat as the baseline scale to extend, not replace)

| Role | Size | Weight |
|---|---|---|
| Modal title (`h2`) | ~18–20px | 700 |
| Section label | 13px | 700 |
| Body/description | 14px | 400–500 |
| Detail label/caption | 12px | 500–600 |
| Button label | 14px | 600 |
| Stat/number (popup tiles) | Large, bold | 700–800 |

## 4. Iconography

- Inline SVG, `stroke="currentColor"`, `stroke-width="2"`, `viewBox="0 0 24 24"` — matches the existing hand-drawn icon set in `content.js` (alert triangle, lock, building, person, shield, send, chevron, ID card). **Reuse this exact icon set and stroke style** for any new UI (e.g., a document/file icon for the new attachment-scanning feature) rather than introducing a different icon library — mixing stroke weights/styles across one modal is an easy, avoidable inconsistency.
- No filled icons, no emoji in UI chrome (the one exception, "⚠️" in the Layer 2 high-risk title, is a minor inconsistency worth reconciling — either commit to emoji accents everywhere or remove this one).

## 5. Layout & spacing conventions

- Modal max-width: `min(680px, 94vw)`, centered, `backdrop-filter: blur(4px)` over a `rgba(9, 12, 18, 0.72)` scrim.
- Popup width: fixed `390px` (toolbar popup constraint).
- Card/section border-radius: dashboard config defines `lg: 8px, md: 6px, sm: 4px` — apply this scale to the modal and popup too for consistency (currently the modal uses ad hoc radii inline).
- Category/summary cards: icon + label + count, in a horizontal row, consistent across the Layer 1 modal's category summary and the popup's category-breakdown section — this pattern already works well, reuse it for the dashboard's category view rather than a different chart-first treatment.

## 6. Motion

- Buttons: `transform`/`background`/`box-shadow` transitions at 120–150ms ease — keep transitions this short; this is an interruption UI, not a marketing surface, and shouldn't feel sluggish to dismiss or act on.
- No entrance animation currently on the modal itself (`appendChild` with no transition). A subtle fade/scale-in (150–200ms) would reduce the jarring "instant full-screen takeover" feel without adding meaningful latency — worth considering, not yet implemented.

## 7. Accessibility notes (partially implemented, keep extending)

- Modal already sets `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`, and focuses the close button on open, plus Escape-to-close. **Preserve this pattern in any new overlay** (e.g., a future document-specific warning variant).
- Category cards use `aria-label` on the summary group — extend this convention to any new summary/stat UI.
- Color is never the only signal for risk level — text labels ("Critical", "High", etc.) always accompany color. Keep this invariant; don't add a color-only status indicator anywhere.
