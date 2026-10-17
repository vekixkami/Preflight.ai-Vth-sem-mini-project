"""Generates the report figures for Preflight.ai as SVG.

Run:  python3 report_diagrams/make_diagrams.py
Out:  report_diagrams/fig1_1_system_architecture.svg
      report_diagrams/fig3_1_dfd_level0_level1.svg
"""
from pathlib import Path
from html import escape

OUT = Path(__file__).resolve().parent

FONT = "Helvetica, Arial, sans-serif"
INK = "#1f2937"
MUTED = "#4b5563"
LINE = "#374151"

# Palette (print-friendly, close to the reference figure)
BLUE_FILL, BLUE_STROKE = "#dbe7f6", "#5b7fb5"
DEEP_FILL = "#c4d7f0"
GREY_FILL, GREY_STROKE = "#eef1f5", "#6b7280"
AMBER_FILL, AMBER_STROKE = "#fdf3dc", "#b7862b"
BAND_FILL, BAND_STROKE = "#f7f9fc", "#b8c4d6"


def text_width(s, size):
    return len(s) * size * 0.54


class Svg:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.shapes = []   # boxes, bands
        self.lines = []    # arrows (drawn above shapes)
        self.labels = []   # arrow labels (drawn last, with white halo)

    def add(self, s):
        self.shapes.append(s)

    def text(self, x, y, s, size=13, weight="normal", anchor="middle", fill=INK, italic=False, layer=None):
        style = ' font-style="italic"' if italic else ""
        el = (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
              f'text-anchor="{anchor}" fill="{fill}"{style}>{escape(s)}</text>')
        (layer if layer is not None else self.shapes).append(el)

    def box(self, x, y, w, h, title, lines=(), fill=BLUE_FILL, stroke=BLUE_STROKE, rx=10, title_size=15, line_size=12, dashed=False):
        dash = ' stroke-dasharray="6 4"' if dashed else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.6"{dash}/>')
        n = 1 + len(lines)
        block = title_size + (n - 1) * (line_size + 5)
        ty = y + (h - block) / 2 + title_size - 2
        self.text(x + w / 2, ty, title, size=title_size, weight="bold")
        for i, ln in enumerate(lines):
            self.text(x + w / 2, ty + (i + 1) * (line_size + 5) + 1, ln, size=line_size, fill=MUTED)

    def cylinder(self, x, y, w, h, title, lines=()):
        ry = 10
        self.add(f'<path d="M{x} {y+ry} L{x} {y+h-ry} A{w/2} {ry} 0 0 0 {x+w} {y+h-ry} L{x+w} {y+ry}" '
                 f'fill="{AMBER_FILL}" stroke="{AMBER_STROKE}" stroke-width="1.6"/>')
        self.add(f'<ellipse cx="{x+w/2}" cy="{y+ry}" rx="{w/2}" ry="{ry}" fill="#fbe9bf" stroke="{AMBER_STROKE}" stroke-width="1.6"/>')
        n = 1 + len(lines)
        block = 15 + (n - 1) * 17
        ty = y + ry + (h - ry - block) / 2 + 13
        self.text(x + w / 2, ty, title, size=14, weight="bold")
        for i, ln in enumerate(lines):
            self.text(x + w / 2, ty + (i + 1) * 17, ln, size=12, fill=MUTED)

    def arrow(self, d, both=False, dashed=False, color=LINE):
        dash = ' stroke-dasharray="6 4"' if dashed else ""
        start = ' marker-start="url(#ah-start)"' if both else ""
        self.lines.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6"{dash}{start} marker-end="url(#ah)"/>')

    def label(self, x, y, lines, size=11.5, anchor="middle", italic=False):
        if isinstance(lines, str):
            lines = [lines]
        w = max(text_width(s, size) for s in lines) + 8
        h = len(lines) * (size + 3) + 4
        if anchor == "middle":
            rx = x - w / 2
        elif anchor == "start":
            rx = x - 4
        else:
            rx = x - w + 4
        self.labels.append(f'<rect x="{rx:.1f}" y="{y - size - 1:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#ffffff" fill-opacity="0.92"/>')
        for i, s in enumerate(lines):
            self.text(x, y + i * (size + 3), s, size=size, anchor=anchor, fill=INK, italic=italic, layer=self.labels)

    def render(self, path):
        defs = f'''<defs>
  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="{LINE}"/>
  </marker>
  <marker id="ah-start" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="{LINE}"/>
  </marker>
</defs>'''
        body = "\n".join(self.shapes + self.lines + self.labels)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">\n'
               f'{defs}\n<rect width="100%" height="100%" fill="#ffffff"/>\n{body}\n</svg>\n')
        path.write_text(svg, encoding="utf-8")


# ---------------------------------------------------------------------------
# Figure 1.1 — System architecture (layered view, matches Section 3.1)
# ---------------------------------------------------------------------------
def figure_architecture():
    s = Svg(1700, 1250)

    def band(y, h, name):
        s.add(f'<rect x="20" y="{y}" width="1660" height="{h}" rx="12" fill="{BAND_FILL}" stroke="{BAND_STROKE}" stroke-width="1.4"/>')
        s.add(f'<rect x="20" y="{y}" width="42" height="{h}" rx="12" fill="{DEEP_FILL}" stroke="{BAND_STROKE}" stroke-width="1.4"/>')
        cx, cy = 41, y + h / 2
        s.add(f'<text x="{cx}" y="{cy}" transform="rotate(-90 {cx} {cy})" font-family="{FONT}" font-size="14" '
              f'font-weight="bold" letter-spacing="1.5" text-anchor="middle" dominant-baseline="middle" fill="{INK}">{name}</text>')

    def group(x, y, w, h, title):
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="none" stroke="{BLUE_STROKE}" stroke-width="1.3" stroke-dasharray="7 5"/>')
        s.text(x + 14, y + 20, title, size=12.5, weight="bold", anchor="start", fill=BLUE_STROKE)

    # Bands
    band(20, 150, "PAGE LAYER")
    band(190, 370, "EXTENSION LAYER")
    band(580, 250, "BACKEND LAYER")
    band(850, 200, "DATA LAYER")
    band(1070, 160, "ADMIN LAYER")

    # --- Page layer -------------------------------------------------------
    s.text(90, 52, "AI platform tab — ChatGPT · Claude · Gemini · Copilot · Perplexity", size=14, weight="bold", anchor="start")
    s.text(90, 78, "The extension never modifies site code;", size=12.5, anchor="start", fill=MUTED, italic=True)
    s.text(90, 96, "it only observes DOM events (capture phase).", size=12.5, anchor="start", fill=MUTED, italic=True)
    s.box(560, 70, 220, 70, "Prompt Composer", ["textarea / contenteditable"], fill=GREY_FILL, stroke=GREY_STROKE)
    s.box(900, 70, 200, 70, "Send Control", ["button click / Enter key"], fill=GREY_FILL, stroke=GREY_STROKE)
    s.box(1180, 70, 220, 70, "File Attachments", ["file input · drop · paste"], fill=GREY_FILL, stroke=GREY_STROKE)
    s.box(1440, 70, 200, 70, "Response Area", ["assistant reply"], fill=GREY_FILL, stroke=GREY_STROKE)

    # --- Extension layer --------------------------------------------------
    group(75, 205, 390, 340, "Service worker & extension pages")
    group(495, 205, 1170, 340, "Content scripts (injected into AI sites)")
    s.box(100, 240, 340, 135, "background.js", ["Service worker", "Layer 2 client (1.5 s timeout)", "Telemetry + offline retry queue", "Only network egress"], fill=DEEP_FILL)
    s.box(100, 420, 340, 100, "Popup", ["popup.html / popup.js", "Local analytics · CSV / JSON export"])
    s.box(820, 245, 360, 110, "content.js", ["Send interceptor &", "pipeline orchestrator"], fill=DEEP_FILL, title_size=16)
    s.box(520, 420, 280, 105, "detectors.js", ["Layer 1 rule engine", "Regex · checksums · keywords", "Safe-data replacement"])
    s.box(860, 420, 280, 105, "fileScanner.js", ["PDF / DOCX / TXT text", "extraction (pdf.js, mammoth)"])
    s.box(1200, 420, 440, 105, "Warning Overlay", ["warning.css", "Replace with Safe Data · Send Anyway · Cancel"])

    # Page -> content.js
    s.arrow("M670 140 V215 H880 V245")
    s.arrow("M1000 140 V245")
    s.arrow("M1290 140 V215 H1120 V245")
    s.arrow("M1540 140 V300 H1180")
    s.label(1000, 186, "DOM events: click · keydown · submit · paste · drop · change")
    s.label(1400, 293, "MutationObserver")

    # content.js <-> components
    s.arrow("M900 355 V388 H660 V420", both=True)
    s.arrow("M1000 355 V420", both=True)
    s.arrow("M1100 355 V388 H1420 V420")

    # content.js <-> background.js
    s.arrow("M820 300 H440", both=True)
    s.label(630, 292, "chrome.runtime.sendMessage")
    s.label(630, 320, "LAYER2_CLASSIFY · LOG_EVENT", size=10.5)

    # --- Backend layer ----------------------------------------------------
    s.text(1660, 604, "FastAPI · Python · Pydantic v2", size=12.5, anchor="end", fill=MUTED, italic=True)
    s.box(170, 635, 350, 170, "POST /classify", ["TF-IDF + Logistic Regression", "(7 content classes)", "NER: spaCy / regex fallback", "Risk scoring → high · medium · low", "model: text_classifier.joblib"], fill=DEEP_FILL)
    s.box(590, 660, 200, 120, "auth.py", ["Bearer token →", "organisation & plan", "(plan gating)"])
    s.box(840, 660, 180, 120, "GET /config", ["plan &", "feature flags"])
    s.box(1060, 660, 250, 120, "POST /api/scan-event", ["telemetry ingest", "(validated schema)"])
    s.box(1350, 660, 300, 120, "GET /api/dashboard/*", ["summary · timeline · severity", "categories · heatmap · export"])
    s.arrow("M520 720 H590")
    s.arrow("M840 720 H790")

    # background.js -> backend (lanes in the gap between groups)
    s.arrow("M440 340 H470 V635")
    s.arrow("M440 362 H482 V612 H1185 V660")
    s.label(820, 606, "HTTP POST · Bearer token · fail-open on timeout / error")

    # --- Data layer -------------------------------------------------------
    s.cylinder(80, 880, 380, 145, "chrome.storage.local", ["companyKeywords", "dashboardEvents (capped at 500)", "pendingTelemetryEvents (retry queue)"])
    s.cylinder(1000, 880, 400, 145, "SQLite", ["preflight_monitoring.sqlite3", "scans table (telemetry events)"])

    # popup -> storage, background -> storage, detectors -> storage
    s.arrow("M150 520 V880", dashed=False)
    s.label(158, 845, "read events", anchor="start", size=10.5)
    s.label(96, 845, "writes", anchor="start", size=10.5)
    s.arrow("M100 300 H88 V880")
    s.arrow("M540 525 V950 H460")
    s.label(548, 940, "read keyword list", anchor="start", size=10.5)

    # backend -> sqlite
    s.arrow("M1185 780 V880")
    s.label(1193, 840, "INSERT", anchor="start", size=10.5)
    s.arrow("M1500 780 V960 H1400")
    s.label(1508, 900, "SELECT / aggregate", anchor="start", size=10.5)

    # --- Admin layer ------------------------------------------------------
    s.box(560, 1100, 260, 100, "IT / Compliance Admin", ["dashboard user"], fill=GREY_FILL, stroke=GREY_STROKE)
    s.box(1000, 1095, 520, 110, "Admin Dashboard", ["React · Vite · TypeScript · Recharts", "Bundled in dashboard/dist, opened from the popup"], fill=DEEP_FILL)
    s.arrow("M820 1150 H1000")
    s.label(910, 1142, "views / filters / exports", size=10.5)
    s.arrow("M1600 1095 V780")
    s.label(1592, 1000, ["HTTP GET", "(polls every 30 s)"], anchor="end", size=10.5)

    s.render(OUT / "fig1_1_system_architecture.svg")


# ---------------------------------------------------------------------------
# Figure 3.1 — Level 0 and Level 1 DFD
# ---------------------------------------------------------------------------
def figure_dfd():
    s = Svg(1540, 1230)

    def entity(x, y, w, h, title, sub=None):
        s.box(x, y, w, h, title, [sub] if sub else [], fill=GREY_FILL, stroke=GREY_STROKE, rx=2, title_size=14)

    def process(x, y, w, h, num, title, lines=()):
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{BLUE_FILL}" stroke="{BLUE_STROKE}" stroke-width="1.6"/>')
        s.add(f'<path d="M{x} {y+26} H{x+w}" stroke="{BLUE_STROKE}" stroke-width="1.2"/>')
        s.text(x + w / 2, y + 18, num, size=13, weight="bold", fill=BLUE_STROKE)
        block = 14 + len(lines) * 16
        ty = y + 26 + (h - 26 - block) / 2 + 12
        s.text(x + w / 2, ty, title, size=13.5, weight="bold")
        for i, ln in enumerate(lines):
            s.text(x + w / 2, ty + (i + 1) * 16, ln, size=11.5, fill=MUTED)

    def store(x, y, w, h, tag, title):
        s.add(f'<path d="M{x+w} {y} H{x} V{y+h} H{x+w}" fill="{AMBER_FILL}" stroke="{AMBER_STROKE}" stroke-width="1.6"/>')
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{AMBER_FILL}" stroke="none"/>')
        s.add(f'<path d="M{x+w} {y} H{x} V{y+h} H{x+w}" fill="none" stroke="{AMBER_STROKE}" stroke-width="1.6"/>')
        s.add(f'<path d="M{x+44} {y} V{y+h}" stroke="{AMBER_STROKE}" stroke-width="1.4"/>')
        s.text(x + 22, y + h / 2 + 5, tag, size=13, weight="bold")
        s.text(x + 44 + (w - 44) / 2, y + h / 2 + 5, title, size=12.5)

    # ---------------- Level 0 ----------------
    s.text(30, 36, "LEVEL 0 — CONTEXT DIAGRAM", size=15, weight="bold", anchor="start")
    cx, cy, r = 760, 215, 105
    s.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{BLUE_FILL}" stroke="{BLUE_STROKE}" stroke-width="2"/>')
    s.text(cx, cy - 34, "0", size=15, weight="bold", fill=BLUE_STROKE)
    s.text(cx, cy - 6, "Preflight.ai", size=17, weight="bold")
    s.text(cx, cy + 16, "DLP System", size=15, weight="bold")
    s.text(cx, cy + 38, "(extension + backend)", size=11.5, fill=MUTED)

    entity(60, 175, 210, 80, "Employee", "(end user)")
    entity(1230, 105, 250, 80, "AI Platform", "ChatGPT · Claude · Gemini …")
    entity(1230, 250, 250, 80, "IT / Compliance Admin")

    import math
    def cx_at(y, side):
        dx = math.sqrt(r * r - (y - cy) ** 2)
        return cx - dx if side == "left" else cx + dx

    s.arrow(f"M270 195 H{cx_at(195,'left'):.1f}")
    s.label(462, 188, "prompt, attachments, send action, decision")
    s.arrow(f"M{cx_at(235,'left'):.1f} 235 H270")
    s.label(462, 254, "warning (findings, risk level), safe-data rewrite")

    s.arrow(f"M{cx_at(130,'right'):.1f} 130 H1230")
    s.label(1035, 123, "approved / sanitized prompt")
    s.arrow(f"M1230 165 H{cx_at(165,'right'):.1f}")
    s.label(1035, 158, "rendered response (send confirmation)")
    s.arrow(f"M{cx_at(270,'right'):.1f} 270 H1230")
    s.label(1035, 263, "dashboard metrics, CSV / JSON reports")
    s.arrow(f"M1230 305 H{cx_at(305,'right'):.1f}")
    s.label(1035, 298, "filters, export requests")

    # separator
    s.add('<path d="M20 375 H1520" stroke="#9ca3af" stroke-width="1.4" stroke-dasharray="8 6"/>')
    s.text(30, 410, "LEVEL 1 — PROCESS DECOMPOSITION", size=15, weight="bold", anchor="start")

    # ---------------- Level 1 ----------------
    # entities
    entity(40, 700, 190, 90, "Employee")
    entity(40, 880, 190, 90, "AI Platform")
    entity(920, 1075, 200, 90, "IT / Compliance", "Admin")

    # processes
    process(300, 470, 210, 120, "1.0", "Capture Input", ["intercept send (sync),", "queue attachments"])
    process(610, 470, 210, 120, "2.0", "Build Scan Text", ["extract PDF / DOCX / TXT", "+ prompt text"])
    process(920, 470, 210, 120, "3.0", "Layer 1 Rule Scan", ["regex, checksums,", "company keywords"])
    process(920, 690, 210, 120, "4.0", "Layer 2 ML Classify", ["type, confidence, risk", "(fail-open if unavailable)"])
    process(610, 690, 210, 120, "5.0", "Warn & Resolve", ["overlay; replace /", "send anyway / cancel"])
    process(920, 870, 210, 120, "6.0", "Log Telemetry", ["metadata only,", "offline retry queue"])
    process(1250, 1060, 210, 120, "7.0", "Dashboard & Reports", ["aggregate, filter,", "export CSV / JSON"])

    # data stores
    store(1250, 505, 250, 50, "D1", "Company Keywords")
    store(1250, 725, 250, 50, "D4", "Classifier Model")
    store(1250, 865, 250, 46, "D2", "Local Event Cache")
    store(1250, 945, 250, 46, "D3", "Scan Events DB")

    # flows
    s.arrow("M135 700 V530 H300")
    s.label(143, 620, ["prompt, attachments,", "send click / Enter"], anchor="start")
    s.arrow("M510 530 H610")
    s.label(560, 500, ["prompt +", "files"])
    s.arrow("M820 530 H920")
    s.label(870, 500, ["combined", "scan text"])
    s.arrow("M1250 530 H1130")
    s.label(1190, 515, "keywords")

    s.arrow("M1080 590 V690")
    s.label(1088, 645, ["clean text", "(no findings)"], anchor="start")
    s.arrow("M970 590 V640 H715 V690")
    s.label(842, 632, "L1 findings (type, risk)")
    s.arrow("M1250 750 H1130")
    s.label(1190, 722, ["trained", "model"])
    s.arrow("M920 750 H820")
    s.label(870, 722, ["L2 verdict", "(risk, type)"])

    s.arrow("M610 725 H230")
    s.label(420, 718, "warning + details, safe-data rewrite")
    s.arrow("M230 765 H610")
    s.label(420, 758, "decision: replace / send anyway / cancel")

    s.arrow("M660 810 V925 H230")
    s.label(445, 918, "approved / sanitized prompt")
    s.arrow("M770 810 V925 H920")
    s.label(778, 860, ["decision event (action,", "finding types, severity;", "no raw text)"], anchor="start", size=10.5)

    s.arrow("M135 970 V1020 H1025 V990")
    s.label(580, 1013, "rendered response (post-send confirmation)")

    s.arrow("M1130 888 H1250")
    s.label(1190, 880, "event record", size=10.5)
    s.arrow("M1130 968 H1250")
    s.label(1190, 960, "HTTP POST", size=10.5)

    s.arrow("M1355 991 V1060")
    s.label(1363, 1030, "query", anchor="start", size=10.5)
    s.arrow("M1500 888 H1525 V1120 H1460")
    s.label(1518, 1020, ["local", "events"], anchor="end", size=10.5)

    s.arrow("M1250 1100 H1120")
    s.label(1185, 1092, "metrics, reports", size=10.5)
    s.arrow("M1120 1140 H1250")
    s.label(1185, 1132, "filters, export", size=10.5)

    # legend
    lx, ly = 40, 1080
    s.text(lx, ly, "Notation", size=13, weight="bold", anchor="start")
    s.add(f'<rect x="{lx}" y="{ly+14}" width="56" height="30" rx="2" fill="{GREY_FILL}" stroke="{GREY_STROKE}" stroke-width="1.4"/>')
    s.text(lx + 66, ly + 34, "External entity", size=12, anchor="start")
    s.add(f'<rect x="{lx+190}" y="{ly+14}" width="56" height="30" rx="8" fill="{BLUE_FILL}" stroke="{BLUE_STROKE}" stroke-width="1.4"/>')
    s.text(lx + 256, ly + 34, "Process", size=12, anchor="start")
    s.add(f'<path d="M{lx+56} {ly+60} H{lx} V{ly+90} H{lx+56}" fill="{AMBER_FILL}" stroke="{AMBER_STROKE}" stroke-width="1.4"/>')
    s.text(lx + 66, ly + 80, "Data store", size=12, anchor="start")
    s.add(f'<path d="M{lx+190} {ly+75} H{lx+240}" stroke="{LINE}" stroke-width="1.6" marker-end="url(#ah)"/>')
    s.text(lx + 256, ly + 80, "Data flow", size=12, anchor="start")

    s.render(OUT / "fig3_1_dfd_level0_level1.svg")


if __name__ == "__main__":
    figure_architecture()
    figure_dfd()
    print("wrote", OUT)
