/**
 * background.js
 * Service worker — handles all network communication so content
 * scripts never need host permissions for the backend API directly.
 *
 * Receives SENTINEL_LOG_EVENT messages from content.js and forwards
 * them to the backend. Also handles fetching the company keyword
 * list on install/login and caching it in chrome.storage.local.
 *
 * Layer 2 integration: handles PREFLIGHT_LAYER2_CLASSIFY messages and
 * calls the ML classification backend, returning the result to content.js.
 */

importScripts("services/telemetryReporter.js");

const BACKEND_URL = "https://api.sentinelai.app"; // placeholder — pilot backend (logging)

console.log("[Preflight] background service worker loaded");

// ---------------------------------------------------------------------
// Central configuration — all Layer 2 settings live here, nowhere else
// ---------------------------------------------------------------------
const PREFLIGHT_CONFIG = {
  API_BASE_URL: "http://localhost:8000",
  TOKEN: "tok_growth_bravo",   // swap to tok_business_delta for Layer 3 trigger
  ENABLE_LAYER2: true,
  TIMEOUT_MS: 1500,
};

const DASHBOARD_EVENTS_KEY = "dashboardEvents";
const PENDING_TELEMETRY_KEY = "pendingTelemetryEvents";
const MAX_DASHBOARD_EVENTS = 500;
const MAX_PENDING_TELEMETRY = 200;

const LAYER1_BUSINESS_TYPES = new Set(["company_keyword", "file_reference", "source_code"]);

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

function normalizeDashboardEvent(payload) {
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const layer2 = payload.layer2 || null;
  const layer1Count = findings.length;
  const layer2Count = layer2 && layer2.content_type !== "general" ? 1 : 0;
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
    layer1_detections_count: layer1Count,
    layer2_detections_count: layer2Count,
    severity: highestSeverity(findings, layer2),
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
  const layer1Detections = findings.map((finding) => finding.type).filter(Boolean);
  const layer2Detections = layer2 && layer2.content_type && layer2.content_type !== "general"
    ? [layer2.content_type]
    : [];

  return {
    timestamp: new Date(payload.timestamp || Date.now()).toISOString(),
    input_preview: payload.input_preview || "",
    layer1_detections: layer1Detections,
    layer2_detections: layer2Detections,
    severity: highestSeverity(findings, layer2),
    decision: payload.decision ?? null,
    action_taken: payload.action_taken ?? null,
    latency_ms: Number(payload.latency_ms || 0),
    source: "chrome_extension",
    extension_version: chrome.runtime.getManifest().version,
    browser_type: detectBrowserName(),
    ai_platform: payload.ai_platform || payload.site || "unknown",
    domain: payload.domain || "unknown",
    page_title: payload.page_title || "unknown",
    input_source: payload.input_source || "text_field",
    user_id: payload.user_id ?? null,
    device_id: payload.device_id ?? null,
    organization_id: payload.organization_id ?? null,
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PREFLIGHT_CONFIG.TIMEOUT_MS);

  try {
    console.log("[Preflight] calling backend", { url: `${PREFLIGHT_CONFIG.API_BASE_URL}/classify`, textLength: text.length });

    const response = await fetch(`${PREFLIGHT_CONFIG.API_BASE_URL}/classify`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PREFLIGHT_CONFIG.TOKEN}`,
      },
      body: JSON.stringify({ text }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.warn("[Preflight] Layer2 response non-OK", response.status, body);
      return { success: false, error: `HTTP ${response.status}: ${body.detail || "unknown error"}` };
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
      console.warn("[Preflight] Layer2 timeout — exceeded", PREFLIGHT_CONFIG.TIMEOUT_MS, "ms");
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
  console.log("[Preflight] background received message", {
    type: message?.type,
    tabId: sender?.tab?.id,
  });

  if (message.type === "SENTINEL_LOG_EVENT") {
    sendLogToBackend(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.warn("[Preflight] log handler error —", err.message);
        sendResponse({ success: false, error: "log_handler_error" });
      });
    return true;
  }

  if (message.type === "PREFLIGHT_LAYER2_CLASSIFY") {
    console.log("[Preflight] background received Layer2 request", { textLength: message.text?.length || 0 });
    if (!PREFLIGHT_CONFIG.ENABLE_LAYER2) {
      console.warn("[Preflight] ENABLE_LAYER2 is false — returning disabled");
      sendResponse({ success: false, error: "layer2_disabled" });
      return true;
    }
    if (typeof message.text !== "string" || message.text.trim().length === 0) {
      console.warn("[Preflight] Layer2 request missing text — returning invalid_request");
      sendResponse({ success: false, error: "invalid_request" });
      return true;
    }
    // Must return true synchronously to keep the channel open for the
    // async response (Chrome closes it if we don't return true).
    callLayer2Classify(message.text).then((result) => {
      console.log("[Preflight] response returned to content script");
      sendResponse(result);
    }).catch((err) => {
      console.warn("[Preflight] Layer2 handler error —", err.message);
      sendResponse({ success: false, error: "handler_error" });
    });
    return true;
  }

});

async function sendLogToBackend(payload) {
  try {
    await storeDashboardEvent(payload);
    if (payload.stage !== "post_send_confirmed") {
      const telemetryPayload = telemetryPayloadFromLog(payload);
      const sent = await sendTelemetry(telemetryPayload);
      if (!sent) await queueTelemetry(telemetryPayload);
    }
    const { authToken } = await chrome.storage.local.get(["authToken"]);
    if (!authToken) {
      // Extension not yet linked to a company account.
      // For pilot, we still want local visibility — cache to local log.
      await cacheLocally(payload);
      return { success: true };
    }

    try {
      await fetch(`${BACKEND_URL}/v1/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      await cacheLocally(payload);
    }
  } catch (err) {
    // Network failure shouldn't block the user — queue for retry.
    await cacheLocally(payload);
    return { success: false, error: "log_failed" };
  }
  return { success: true };
}

async function queueTelemetry(payload) {
  const { [PENDING_TELEMETRY_KEY]: pendingTelemetry = [] } = await chrome.storage.local.get([PENDING_TELEMETRY_KEY]);
  pendingTelemetry.push(payload);
  await chrome.storage.local.set({
    [PENDING_TELEMETRY_KEY]: pendingTelemetry.slice(-MAX_PENDING_TELEMETRY),
  });
}

async function cacheLocally(payload) {
  const { pendingEvents = [] } = await chrome.storage.local.get(["pendingEvents"]);
  pendingEvents.push(payload);
  await chrome.storage.local.set({ pendingEvents });
}

// Periodically flush any queued events once back online
chrome.alarms.create("sentinel-flush-queue", { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "sentinel-flush-queue") return;
  await flushTelemetryQueue();
  const { pendingEvents = [], authToken } = await chrome.storage.local.get(["pendingEvents", "authToken"]);
  if (!authToken || pendingEvents.length === 0) return;

  try {
    await fetch(`${BACKEND_URL}/v1/events/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ events: pendingEvents }),
    });
    await chrome.storage.local.set({ pendingEvents: [] });
  } catch (err) {
    // still offline, leave queue intact for next retry
  }
});

async function flushTelemetryQueue() {
  const { [PENDING_TELEMETRY_KEY]: pendingTelemetry = [] } = await chrome.storage.local.get([PENDING_TELEMETRY_KEY]);
  if (!pendingTelemetry.length) return;

  const stillPending = [];
  for (const payload of pendingTelemetry) {
    const sent = await sendTelemetry(payload);
    if (!sent) stillPending.push(payload);
  }
  await chrome.storage.local.set({ [PENDING_TELEMETRY_KEY]: stillPending.slice(-MAX_PENDING_TELEMETRY) });
}

// Fetch and cache the company's keyword list (called after onboarding/login)
async function refreshCompanyKeywords() {
  const { authToken } = await chrome.storage.local.get(["authToken"]);
  if (!authToken) return;
  try {
    const res = await fetch(`${BACKEND_URL}/v1/companies/me/keywords`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    await chrome.storage.local.set({ companyKeywords: data.keywords || [] });
  } catch (err) {
    // keep using whatever is already cached
  }
}

chrome.runtime.onInstalled.addListener(() => {
  refreshCompanyKeywords();
});
