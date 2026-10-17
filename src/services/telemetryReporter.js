// Sends one telemetry event to the Preflight backend.
// Returns { ok, status } — status is the HTTP status, or null when the
// backend could not be reached — so the caller can decide whether to retry.
async function sendTelemetry(settings, scanData) {
  try {
    const response = await fetch(`${settings.apiBaseUrl}/api/scan-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiToken}`,
      },
      body: JSON.stringify(scanData),
    });
    if (!response.ok) {
      console.warn("[Preflight] telemetry not delivered — HTTP", response.status);
    }
    return { ok: response.ok, status: response.status };
  } catch (error) {
    console.warn("[Preflight] telemetry not delivered —", error.message);
    return { ok: false, status: null };
  }
}
