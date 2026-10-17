// Runs src/background.js against a mocked chrome API (no browser needed).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createWorker({ settings, fetchImpl }) {
  const store = settings ? { preflightSettings: settings } : {};
  const listeners = { message: null, storageChanged: null };
  const fetchCalls = [];

  const chrome = {
    runtime: {
      getManifest: () => ({ version: "9.9.9" }),
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      openOptionsPage: () => {},
    },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (items) => { Object.assign(store, items); },
        remove: async (keys) => { keys.forEach((k) => delete store[k]); },
      },
      onChanged: { addListener: (fn) => { listeners.storageChanged = fn; } },
    },
  };

  const context = {
    chrome,
    console: { log() {}, warn() {}, error() {} },
    navigator: { userAgent: "Mozilla/5.0 Chrome/120 Safari/537" },
    AbortController,
    setTimeout,
    clearTimeout,
    JSON,
    Date,
    Math,
    Number,
    String,
    Array,
    Set,
    Promise,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return fetchImpl(url, options);
    },
    importScripts: (file) => {
      const source = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
      vm.runInContext(source, context);
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8"), context);

  // Objects built inside the vm context have a different prototype; round-trip
  // through JSON so assertions compare plain values.
  const send = (message) => new Promise((resolve) => {
    const keepOpen = listeners.message(message, {}, (value) => resolve(JSON.parse(JSON.stringify(value))));
    assert.equal(keepOpen, true, "async handlers must keep the message channel open");
  });
  // Simulates the options page saving new settings.
  const saveSettings = async (settings) => {
    store.preflightSettings = settings;
    listeners.storageChanged({ preflightSettings: { newValue: settings } }, "local");
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const plain = (key) => JSON.parse(JSON.stringify(store[key] ?? null));
  return { send, store, plain, saveSettings, fetchCalls };
}

const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

(async () => {
  // Layer 2 is skipped (fail open) until a token is configured.
  let worker = createWorker({ settings: null, fetchImpl: ok({}) });
  let response = await worker.send({ type: "PREFLIGHT_LAYER2_CLASSIFY", text: "hello" });
  assert.deepEqual(response, { success: false, error: "not_configured" });
  assert.equal(worker.fetchCalls.length, 0, "no request without a token");

  // With settings, the configured URL and token are used — not hardcoded values.
  const verdict = { content_type: "contract", risk_level: "high", confidence: 0.9 };
  worker = createWorker({ settings: { apiBaseUrl: "https://api.example.test/", apiToken: "tok_x", enableLayer2: true }, fetchImpl: ok(verdict) });
  response = await worker.send({ type: "PREFLIGHT_LAYER2_CLASSIFY", text: "some agreement" });
  assert.equal(response.success, true);
  assert.equal(worker.fetchCalls[0].url, "https://api.example.test/classify");
  assert.equal(worker.fetchCalls[0].options.headers.Authorization, "Bearer tok_x");

  // Layer 2 can be switched off.
  worker = createWorker({ settings: { apiToken: "tok_x", enableLayer2: false }, fetchImpl: ok(verdict) });
  response = await worker.send({ type: "PREFLIGHT_LAYER2_CLASSIFY", text: "x" });
  assert.equal(response.error, "layer2_disabled");

  // Backend errors fail open with a short code, not response bodies.
  worker = createWorker({ settings: { apiToken: "tok_x" }, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ detail: "secret detail" }) }) });
  response = await worker.send({ type: "PREFLIGHT_LAYER2_CLASSIFY", text: "x" });
  assert.deepEqual(response, { success: false, error: "http_403" });

  // Logging: decision is stored, telemetry carries no prompt-derived fields.
  worker = createWorker({ settings: { apiToken: "tok_x" }, fetchImpl: ok({ success: true }) });
  response = await worker.send({
    type: "PREFLIGHT_LOG_EVENT",
    payload: {
      stage: "pre_send",
      action: "cancelled",
      decision: "cancelled",
      action_taken: "cancelled",
      findings: [{ type: "pan", riskLevel: "critical" }],
      textLength: 20,
      latency_ms: 7,
      timestamp: Date.now(),
      site: "chatgpt",
      ai_platform: "chatgpt",
      domain: "chatgpt.com",
      input_preview: "pan card: ABCDE1234F",
      page_title: "Chat about ABCDE1234F",
    },
  });
  assert.equal(response.success, true);
  const [event] = JSON.parse(JSON.stringify(worker.store.dashboardEvents));
  assert.equal(event.decision, "cancelled");
  assert.equal(event.severity, "critical");
  assert.deepEqual(event.categories, ["PII"]);
  const sent = JSON.parse(worker.fetchCalls[0].options.body);
  assert.equal(worker.fetchCalls[0].url, "http://localhost:8000/api/scan-event");
  assert.equal(sent.decision, "cancelled");
  assert.deepEqual(sent.layer1_detections, ["pan"]);
  assert.equal(sent.extension_version, "9.9.9");
  assert.ok(!JSON.stringify(sent).includes("ABCDE1234F"), "no prompt text may leave the extension");
  assert.ok(!("input_preview" in sent) && !("page_title" in sent));

  // A low-risk Layer 2 verdict is not counted as a detection.
  worker = createWorker({ settings: { apiToken: "tok_x" }, fetchImpl: ok({}) });
  await worker.send({ type: "PREFLIGHT_LOG_EVENT", payload: { stage: "pre_send", action: "layer2_verdict_low", decision: "allowed", findings: [], layer2: { risk_level: "low", content_type: "strategy_doc", confidence: 0.1 }, timestamp: Date.now() } });
  const lowEvent = JSON.parse(JSON.stringify(worker.store.dashboardEvents[0]));
  assert.equal(lowEvent.layer2_detections_count, 0);
  assert.equal(lowEvent.severity, "none");

  const logEvent = (decision = "cancelled") => ({
    type: "PREFLIGHT_LOG_EVENT",
    payload: { stage: "pre_send", action: decision, decision, findings: [{ type: "pan", riskLevel: "critical" }], timestamp: Date.now() },
  });

  // Regression: events from before a token was saved are kept, then delivered
  // as soon as the token is saved (they used to be silently dropped).
  worker = createWorker({ settings: null, fetchImpl: ok({ success: true }) });
  response = await worker.send(logEvent());
  assert.equal(response.delivered, false);
  assert.equal(worker.plain("pendingTelemetryEvents").length, 1);
  assert.equal(worker.plain("telemetryStatus").state, "no_token");
  assert.equal(worker.fetchCalls.length, 0);
  await worker.saveSettings({ apiToken: "tok_x" });
  assert.equal(worker.fetchCalls.length, 1, "queued event is sent once a token is saved");
  assert.equal(worker.plain("pendingTelemetryEvents").length, 0);
  assert.deepEqual(worker.plain("telemetryStatus").state, "ok");

  // Offline backend: events wait in order and are retried, never lost or blocking.
  worker = createWorker({ settings: { apiToken: "tok_x" }, fetchImpl: async () => { throw new Error("offline"); } });
  response = await worker.send(logEvent("sent_anyway"));
  assert.equal(response.success, true);
  response = await worker.send(logEvent("cancelled"));
  assert.equal(worker.plain("pendingTelemetryEvents").length, 2);
  assert.equal(worker.plain("telemetryStatus").state, "offline");

  // Rejected token: events are kept and the popup is told why.
  worker = createWorker({ settings: { apiToken: "tok_bad" }, fetchImpl: async () => ({ ok: false, status: 401 }) });
  await worker.send(logEvent());
  assert.equal(worker.plain("telemetryStatus").state, "rejected");
  assert.equal(worker.plain("pendingTelemetryEvents").length, 1);

  // An event the server will never accept is dropped instead of blocking the queue.
  worker = createWorker({ settings: { apiToken: "tok_x" }, fetchImpl: async () => ({ ok: false, status: 422 }) });
  await worker.send(logEvent());
  assert.equal(worker.plain("pendingTelemetryEvents").length, 0);

  // Post-send confirmations stay local and are never sent as telemetry.
  worker = createWorker({ settings: { apiToken: "tok_x" }, fetchImpl: ok({}) });
  await worker.send({ type: "PREFLIGHT_LOG_EVENT", payload: { stage: "post_send_confirmed", action: "response_received", findings: [], timestamp: Date.now() } });
  assert.equal(worker.fetchCalls.length, 0);

  console.log("background: all tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
