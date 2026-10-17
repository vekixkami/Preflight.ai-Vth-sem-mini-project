// Options page: backend URL, API token, Layer 2 toggle and company keywords.
// Keys must match background.js (preflightSettings) and detectors.js
// (companyKeywords).
const SETTINGS_KEY = "preflightSettings";
const DEFAULT_SETTINGS = {
  apiBaseUrl: "http://localhost:8000",
  apiToken: "",
  enableLayer2: true,
};

const $ = (id) => document.getElementById(id);

function showStatus(message, kind) {
  const status = $("status");
  status.textContent = message;
  status.className = kind || "";
}

function readForm() {
  return {
    settings: {
      apiBaseUrl: $("api-base-url").value.trim().replace(/\/+$/, ""),
      apiToken: $("api-token").value.trim(),
      enableLayer2: $("enable-layer2").checked,
    },
    keywords: $("company-keywords").value
      .split("\n")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  };
}

async function load() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, "companyKeywords"]);
  const settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  $("api-base-url").value = settings.apiBaseUrl;
  $("api-token").value = settings.apiToken;
  $("enable-layer2").checked = Boolean(settings.enableLayer2);
  $("company-keywords").value = (stored.companyKeywords || []).join("\n");
  if (!settings.apiToken) showStatus("Add an API token to turn on the machine-learning check and central logging.", "error");
}

async function save(event) {
  event.preventDefault();
  const { settings, keywords } = readForm();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings, companyKeywords: keywords });
  showStatus("Changes saved.", "ok");
}

async function testConnection() {
  const { settings } = readForm();
  if (!settings.apiToken) {
    showStatus("Enter an API token first.", "error");
    return;
  }
  showStatus("Testing…");
  try {
    const response = await fetch(`${settings.apiBaseUrl}/config`, {
      headers: { Authorization: `Bearer ${settings.apiToken}` },
    });
    if (response.status === 401) {
      showStatus("Backend reachable, but the token was rejected.", "error");
      return;
    }
    if (!response.ok) {
      showStatus(`Backend returned HTTP ${response.status}.`, "error");
      return;
    }
    const config = await response.json();
    const layer2 = config.layer2_enabled ? "Layer 2 enabled" : "Layer 2 not in this plan";
    showStatus(`Connected: ${config.org_id} (${config.plan} plan, ${layer2}).`, "ok");
  } catch (error) {
    showStatus(`Could not reach ${settings.apiBaseUrl} — is the backend running?`, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("settings-form").addEventListener("submit", save);
  $("test-connection").addEventListener("click", testConnection);
});
