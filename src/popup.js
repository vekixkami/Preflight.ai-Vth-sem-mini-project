// Popup: a glance at this browser's recent clearance activity. The full
// history, filters and charts live in the dashboard.
const DASHBOARD_EVENTS_KEY = "dashboardEvents";
const TELEMETRY_STATUS_KEY = "telemetryStatus";
const SETTINGS_KEY = "preflightSettings";
const RECENT_LIMIT = 5;

const DETECTION_LABELS = {
  aadhaar: "Aadhaar", pan: "PAN", gst: "GSTIN", ifsc: "IFSC", bank_account: "Bank account",
  phone: "Phone number", email: "Email", openai_key: "OpenAI key", anthropic_key: "Anthropic key",
  aws_key: "AWS key", jwt: "Access token", db_url: "Database URL", private_key: "Private key",
  generic_secret: "API secret", hardcoded_password: "Password", file_reference: "File name",
  env_content: ".env value", source_code: "Source code", company_keyword: "Company term",
  contract: "Contract", financial_report: "Financial report", hr_doc: "HR document",
  strategy_doc: "Strategy document", customer_data: "Customer data",
};
const PLATFORM_LABELS = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", copilot: "Copilot", perplexity: "Perplexity" };
const SEVERITY = {
  critical: ["Critical", "risk"], high: ["High", "high"], medium: ["Medium", "medium"],
  low: ["Low", "neutral"], none: ["No risk", "neutral"],
};
const OUTCOME = {
  cancelled: ["Stopped", "cleared"], sanitized: ["Rewritten", "cleared"],
  sent_anyway: ["Sent anyway", "risk"], allowed: ["Allowed", "neutral"],
};

let dashboardEvents = [];
const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat();

document.addEventListener("DOMContentLoaded", async () => {
  const result = await chrome.storage.local.get([DASHBOARD_EVENTS_KEY, TELEMETRY_STATUS_KEY, SETTINGS_KEY]);
  // Only scans count; post-send confirmations are bookkeeping, not scans.
  dashboardEvents = (Array.isArray(result[DASHBOARD_EVENTS_KEY]) ? result[DASHBOARD_EVENTS_KEY] : [])
    .filter((event) => event.stage === "pre_send");

  render(dashboardEvents);
  renderSyncStatus(result[TELEMETRY_STATUS_KEY], result[SETTINGS_KEY]);

  $("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dist/index.html") });
  });
  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
  setUpExportMenu();
});

function render(events) {
  const stopped = events.filter((e) => e.decision === "cancelled" || e.decision === "sanitized").length;
  const sent = events.filter((e) => e.decision === "sent_anyway").length;
  const warned = stopped + sent;
  const found = events.reduce((sum, e) => sum + Number(e.layer1_detections_count || 0) + Number(e.layer2_detections_count || 0), 0);

  $("total-scans").textContent = number.format(events.length);
  $("found-count").textContent = number.format(found);
  $("sent-count").textContent = number.format(sent);
  if (sent) $("sent-count").classList.add("text-risk");

  if (warned > 0) {
    const share = stopped / warned;
    const headline = $("headline");
    headline.textContent = "";
    const strong = document.createElement("span");
    strong.className = "text-cleared tabular";
    strong.textContent = number.format(stopped);
    headline.append(strong, ` of ${number.format(warned)} warned prompts were stopped or rewritten before leaving this browser.`);
    $("meter-cleared").style.width = `${share * 100}%`;
    $("meter-risk").style.width = `${(1 - share) * 100}%`;
    $("legend-cleared").textContent = `${Math.round(share * 100)}% kept in the browser`;
    $("legend-risk").textContent = `${number.format(sent)} sent anyway`;
    $("clearance-meter").setAttribute("aria-label", `${Math.round(share * 100)} percent of warned prompts were kept in the browser; ${sent} were sent anyway.`);
    $("clearance").hidden = false;
  } else if (events.length > 0) {
    $("headline").textContent = "Nothing sensitive has needed a warning in this browser.";
  }

  renderRecent(events.slice(0, RECENT_LIMIT));
}

// Whether this browser's activity is reaching the admin dashboard.
function renderSyncStatus(status, settings) {
  const pending = status?.pending || 0;
  const waiting = pending ? ` ${number.format(pending)} ${pending === 1 ? "event is" : "events are"} waiting.` : "";
  let tone = "cleared";
  let text = "Synced with the dashboard.";
  let action = null;

  if (!settings?.apiToken) {
    tone = "high";
    text = `Not syncing to the dashboard — no API token.${waiting}`;
    action = ["Add Token", () => chrome.runtime.openOptionsPage()];
  } else if (status?.state === "rejected") {
    tone = "risk";
    text = `Not syncing — the backend rejected the API token.${waiting}`;
    action = ["Check Settings", () => chrome.runtime.openOptionsPage()];
  } else if (status?.state === "offline") {
    tone = "high";
    text = `Can’t reach the backend.${waiting} They’ll be sent automatically when it’s back.`;
  } else if (!status) {
    return; // nothing has been sent yet
  } else if (pending) {
    tone = "neutral";
    text = `Syncing…${waiting}`;
  }

  $("sync-dot").className = `dot bg-${tone}`;
  $("sync-text").textContent = text;
  const button = $("sync-action");
  if (action) {
    button.textContent = action[0];
    button.onclick = action[1];
    button.hidden = false;
  }
  $("sync-status").hidden = false;
}

function renderRecent(events) {
  const list = $("events");
  $("empty-state").hidden = events.length > 0;
  list.replaceChildren(...events.map((event) => {
    const item = document.createElement("li");
    item.className = "event";

    const row = document.createElement("div");
    row.className = "row";
    const what = document.createElement("span");
    what.className = "what";
    const names = detectedNames(event);
    what.textContent = names.length ? names.join(", ") : "Nothing sensitive";
    if (!names.length) what.classList.add("muted");
    const [outcomeLabel, outcomeTone] = OUTCOME[event.decision] || ["—", "neutral"];
    const outcome = document.createElement("span");
    outcome.className = `outcome text-${outcomeTone}`;
    outcome.textContent = outcomeLabel;
    row.append(what, outcome);

    const meta = document.createElement("div");
    meta.className = "meta";
    const [severityLabel, severityTone] = SEVERITY[event.severity] || SEVERITY.none;
    const dot = document.createElement("i");
    dot.className = `dot bg-${severityTone}`;
    dot.setAttribute("aria-hidden", "true");
    meta.append(dot, `${severityLabel} · ${PLATFORM_LABELS[event.site] || event.site} · ${formatTime(event.timestamp)}`);

    item.append(row, meta);
    return item;
  }));
}

function detectedNames(event) {
  const types = (event.layer1_findings || []).map((finding) => finding.type);
  if (event.layer2_detections_count && event.layer2_result?.content_type) types.push(event.layer2_result.content_type);
  return [...new Set(types)].map((type) => DETECTION_LABELS[type] || String(type).replace(/_/g, " "));
}

function setUpExportMenu() {
  const toggle = $("export-toggle");
  const menu = $("export-menu");
  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.disabled = dashboardEvents.length === 0;
  toggle.addEventListener("click", () => setOpen(menu.hidden));
  document.addEventListener("click", (event) => {
    if (!menu.hidden && !event.target.closest(".export")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  $("export-csv").addEventListener("click", () => { setOpen(false); exportCsv(dashboardEvents); });
  $("export-json").addEventListener("click", () => { setOpen(false); exportJson(dashboardEvents); });
}

function exportCsv(events) {
  const headers = [
    "id", "timestamp", "site", "stage", "severity", "categories",
    "layer1_detections_count", "layer2_detections_count", "decision", "action_taken",
  ];
  const rows = events.map((event) => headers.map((header) => {
    const value = header === "categories" ? (event.categories || []).join("|") : event[header];
    return csvCell(value ?? "");
  }).join(","));
  download(`preflight-activity-${Date.now()}.csv`, [headers.join(","), ...rows].join("\n"), "text/csv");
}

function exportJson(events) {
  download(`preflight-activity-${Date.now()}.json`, JSON.stringify(events, null, 2), "application/json");
}

function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// Quote every cell and neutralise spreadsheet formulas.
function csvCell(value) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function formatTime(timestamp) {
  if (!timestamp) return "Unknown time";
  return new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
