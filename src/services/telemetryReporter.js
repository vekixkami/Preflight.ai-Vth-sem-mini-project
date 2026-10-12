async function sendTelemetry(scanData) {
  try {
    const response = await fetch("http://localhost:8000/api/scan-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(scanData),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Telemetry failed with HTTP ${response.status}${body ? `: ${body}` : ""}`);
    }
    return true;
  } catch (error) {
    console.error("Telemetry failed", error);
    return false;
  }
}
