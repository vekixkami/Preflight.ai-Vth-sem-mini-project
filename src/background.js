/**
 * background.js
 * Service worker — the only part of the extension that talks to the network,
 * so content scripts on AI sites never need backend host permissions.
 *
 * Handles:
 *  - PREFLIGHT_LAYER2_CLASSIFY: calls the Layer 2 ML backend (/classify).
 *  - PREFLIGHT_LOG_EVENT: stores a privacy-safe event for the popup and sends
 *    telemetry to the backend, queueing it for retry while offline.
 *
 * Backend URL and API token are configured on the extension's options page
 * (stored in chrome.storage.local), never hardcoded here.
 */

importScripts("services/telemetryReporter.js");

console.log("[Preflight] background service worker loaded");

const SETTINGS_KEY = "preflightSettings";
const DEFAULT_SETTINGS = {
  apiBaseUrl: "http://localhost:8000",
  apiToken: "",
  enableLayer2: true,
};
const LAYER2_TIMEOUT_MS = 1500;

const DASHBOARD_EVENTS_KEY = "dashboardEvents";
const PENDING_TELEMETRY_KEY = "pendingTelemetryEvents";
const TELEMETRY_STATUS_KEY = "telemetryStatus";
const MAX_DASHBOARD_EVENTS = 500;
const MAX_PENDING_TELEMETRY = 200;
const FLUSH_ALARM = "preflight-flush-queue";

const LAYER1_BUSINESS_TYPES = new Set(["company_keyword", "file_reference", "source_code"]);

async function getSettings() {
  const { [SETTINGS_KEY]: stored = {} } = await chrome.storage.local.get([SETTINGS_KEY]);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  settings.apiBaseUrl = String(settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/+$/, "");
  settings.apiToken = String(settings.apiToken || "").trim();
  return settings;
}

function severityRank(level) {
  return { critical: 4, high: 3, medium: 2, low: 1, none: 0 }[level] || 0;
}

function highestSeverity(findings, layer2) {
  const layer1Severity = findings.reduce((highest, finding) => (
    severityRank(finding.riskLevel) > severityRank(highest) ? finding.riskLevel : highest
  ), "none");
  const layer2Severity = layer2?.risk_level || "none";
  return severityRank(layer2Severity) > severityRank(layer1Severity)
    ? layer2Severity
    : layer1Severity;
}

function categoryForLayer1Type(type) {
  const value = typeof type === "string" ? type : "unknown";
  if (value.includes("key") || value.includes("secret") || value.includes("password") || value === "jwt" || value === "db_url" || value === "private_key" || value === "env_content") {
    return "Credentials";
  }
  if (LAYER1_BUSINESS_TYPES.has(value)) return "Business Sensitive";
  return "PII";
}

function categoryForLayer2Type(type) {
  return ({
    contract: "Legal Agreements",
    financial_report: "Financial Forecasts",
    strategy_doc: "Internal Strategy",
    hr_doc: "Internal Documents",
    source_code: "Internal Documents",
    customer_data: "Internal Documents",
    general: "General",
  })[type] || "Sensitive Business";
}

// Layer 2 only counts as a detection when it actually warned (medium/high),
// not merely because the classifier picked a non-"general" label.
function layer2Detected(layer2) {
  return Boolean(layer2 && layer2.content_type && layer2.content_type !== "general" && layer2.risk_level !== "low");
}

function normalizeDashboardEvent(payload) {
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const layer2 = payload.layer2 || null;
  const layer2Count = layer2Detected(layer2) ? 1 : 0;
  const categories = [
    ...findings.map((finding) => categoryForLayer1Type(finding.type)),
    ...(layer2Count ? [categoryForLayer2Type(layer2.content_type)] : []),
  ];

  return {
    id: `${payload.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: payload.timestamp || Date.now(),
    site: payload.site || "unknown",
    stage: payload.stage || "unknown",
    action: payload.action || "unknown",
    textLength: payload.textLength || 0,
    layer1_detections_count: findings.length,
    layer2_detections_count: layer2Count,
    severity: highestSeverity(findings, layer2Count ? layer2 : null),
    categories,
    layer1_findings: findings,
    layer2_result: layer2,
    decision: payload.decision ?? null,
    action_taken: payload.action_taken ?? null,
  };
}

function telemetryPayloadFromLog(payload) {
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const layer2 = payload.layer2 || null;

  return {
    timestamp: new Date(payload.timestamp || Date.now()).toISOString(),
    layer1_detections: findings.map((finding) => finding.type).filter(Boolean),
    layer2_detections: layer2Detected(layer2) ? [layer2.content_type] : [],
    severity: highestSeverity(findings, layer2Detected(layer2) ? layer2 : null),
    decision: payload.decision ?? null,
    action_taken: payload.action_taken ?? null,
    latency_ms: Number(payload.latency_ms || 0),
    source: "chrome_extension",
    extension_version: chrome.runtime.getManifest().version,
    browser_type: detectBrowserName(),
    ai_platform: payload.ai_platform || payload.site || "unknown",
    domain: payload.domain || "unknown",
    input_source: payload.input_source || "text_field",
  };
}

function detectBrowserName() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("brave")) return "brave";
  if (ua.includes("firefox/")) return "firefox";
  if (ua.includes("safari/") && !ua.includes("chrome/") && !ua.includes("chromium/")) return "safari";
  return "chrome";
}

async function storeDashboardEvent(payload) {
  const event = normalizeDashboardEvent(payload);
  const { [DASHBOARD_EVENTS_KEY]: dashboardEvents = [] } = await chrome.storage.local.get([DASHBOARD_EVENTS_KEY]);
  dashboardEvents.unshift(event);
  await chrome.storage.local.set({
    [DASHBOARD_EVENTS_KEY]: dashboardEvents.slice(0, MAX_DASHBOARD_EVENTS),
  });
}

// ---------------------------------------------------------------------
// Layer 2 client — POST /classify with timeout and error handling
// ---------------------------------------------------------------------
async function callLayer2Classify(text) {
  const settings = await getSettings();
  if (!settings.enableLayer2) return { success: false, error: "layer2_disabled" };
  if (!settings.apiToken) {
    console.warn("[Preflight] Layer2 skipped — no API token set. Open the extension's Options page to configure it.");
    return { success: false, error: "not_configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LAYER2_TIMEOUT_MS);

  try {
    console.log("[Preflight] calling backend", { url: `${settings.apiBaseUrl}/classify`, textLength: text.length });

    const response = await fetch(`${settings.apiBaseUrl}/classify`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiToken}`,
      },
      body: JSON.stringify({ text }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.warn("[Preflight] Layer2 response non-OK", response.status, body);
      return { success: false, error: `http_${response.status}` };
    }

    const result = await response.json();
    console.log("[Preflight] backend response received", {
      content_type: result.content_type,
      risk_level: result.risk_level,
      confidence: result.confidence,
      ner_backend: result.ner_backend,
      latency_ms: result.latency_ms,
    });
    return { success: true, result };

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.warn("[Preflight] Layer2 timeout — exceeded", LAYER2_TIMEOUT_MS, "ms");
      return { success: false, error: "timeout" };
    }
    console.warn("[Preflight] Layer2 unavailable —", err.message);
    return { success: false, error: "unavailable" };
  }
}

// ---------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PREFLIGHT_LOG_EVENT") {
    handleLogEvent(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.warn("[Preflight] log handler error —", err.message);
        sendResponse({ success: false, error: "log_handler_error" });
      });
    return true;
  }

  if (message?.type === "PREFLIGHT_LAYER2_CLASSIFY") {
    if (typeof message.text !== "string" || message.text.trim().length === 0) {
      sendResponse({ success: false, error: "invalid_request" });
      return true;
    }
    // Must return true synchronously to keep the channel open for the
    // async response (Chrome closes it if we don't return true).
    callLayer2Classify(message.text).then(sendResponse).catch((err) => {
      console.warn("[Preflight] Layer2 handler error —", err.message);
      sendResponse({ success: false, error: "handler_error" });
    });
    return true;
  }

  return false;
});

async function handleLogEvent(payload) {
  await storeDashboardEvent(payload);
  // Post-send confirmations are local-only; they are not scans.
  if (payload.stage === "post_send_confirmed") return { success: true };

  // Every scan is queued first and delivered from the queue, so nothing is
  // lost while the token is missing or the backend is down.
  await queueTelemetry(telemetryPayloadFromLog(payload));
  const status = await flushTelemetryQueue();
  return { success: true, delivered: status.state === "ok" && status.pending === 0 };
}

// The queue is read-modify-written from several async paths (new events, the
// retry alarm, settings changes); serialise them so no event is dropped.
let queueLock = Promise.resolve();
function withQueueLock(task) {
  const run = queueLock.then(task, task);
  queueLock = run.catch(() => {});
  return run;
}

function queueTelemetry(payload) {
  return withQueueLock(async () => {
    const { [PENDING_TELEMETRY_KEY]: pending = [] } = await chrome.storage.local.get([PENDING_TELEMETRY_KEY]);
    pending.push(payload);
    await chrome.storage.local.set({ [PENDING_TELEMETRY_KEY]: pending.slice(-MAX_PENDING_TELEMETRY) });
  });
}

// Delivers queued events in order and records the outcome for the popup:
//   ok        — everything delivered
//   no_token  — no API token configured yet (events wait in the queue)
//   rejected  — the backend refused the token (401/403)
//   offline   — backend unreachable or failing (5xx); retried later
function flushTelemetryQueue() {
  return withQueueLock(async () => {
    const { [PENDING_TELEMETRY_KEY]: pending = [] } = await chrome.storage.local.get([PENDING_TELEMETRY_KEY]);
    const settings = await getSettings();
    let state = "ok";
    const stillPending = [];

    if (!settings.apiToken) {
      state = "no_token";
      stillPending.push(...pending);
    } else {
      for (const payload of pending) {
        if (state !== "ok") {
          stillPending.push(payload);
          continue;
        }
        const result = await sendTelemetry(settings, payload);
        if (result.ok) continue;
        if (result.status === 401 || result.status === 403) {
          state = "rejected";
          stillPending.push(payload);
        } else if (result.status && result.status >= 400 && result.status < 500 && result.status !== 429) {
          // The server will never accept this event (e.g. invalid shape); drop it
          // rather than block everything queued behind it.
          console.warn("[Preflight] telemetry event rejected by backend with HTTP", result.status, "— dropped");
        } else {
          state = "offline";
          stillPending.push(payload);
        }
      }
    }

    const status = { state, pending: stillPending.length, checkedAt: Date.now() };
    await chrome.storage.local.set({
      [PENDING_TELEMETRY_KEY]: stillPending.slice(-MAX_PENDING_TELEMETRY),
      [TELEMETRY_STATUS_KEY]: status,
    });
    return status;
  });
}

// Periodically retry telemetry queued while the backend was offline.
chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) flushTelemetryQueue();
});

// Deliver anything waiting as soon as a token or backend URL is saved.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) flushTelemetryQueue();
});
chrome.runtime.onStartup.addListener(() => flushTelemetryQueue());

// Older builds cached raw prompt previews and page titles locally
// ("pendingEvents", and input_preview/page_title inside queued telemetry).
// Remove them so no prompt text stays on disk after upgrading.
async function purgeLegacyPromptData() {
  const { [PENDING_TELEMETRY_KEY]: queued = [] } = await chrome.storage.local.get([PENDING_TELEMETRY_KEY]);
  const scrubbed = queued.map(({ input_preview, page_title, ...rest }) => rest);
  await chrome.storage.local.set({ [PENDING_TELEMETRY_KEY]: scrubbed });
  await chrome.storage.local.remove(["pendingEvents", "authToken"]);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await purgeLegacyPromptData();
  const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get([SETTINGS_KEY]);
  if (details.reason === "install" || !stored?.apiToken) {
    chrome.runtime.openOptionsPage();
  }
});
