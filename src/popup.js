const DASHBOARD_EVENTS_KEY = "dashboardEvents";
const SEVERITIES = ["critical", "high", "medium", "low", "none"];
const HEATMAP_CATEGORIES = ["PII", "Credentials", "Business Sensitive", "Legal Agreements", "Financial Forecasts", "Internal Strategy"];

let dashboardEvents = [];

document.addEventListener("DOMContentLoaded", async () => {
  const result = await chrome.storage.local.get([DASHBOARD_EVENTS_KEY]);
  dashboardEvents = Array.isArray(result[DASHBOARD_EVENTS_KEY])
    ? result[DASHBOARD_EVENTS_KEY]
    : [];

  renderDashboard(dashboardEvents);

  document.getElementById("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard/dist/index.html"),
    });
  });
  document.getElementById("export-csv").addEventListener("click", () => exportCsv(dashboardEvents));
  document.getElementById("export-json").addEventListener("click", () => exportJson(dashboardEvents));
});

function renderDashboard(events) {
  const totalScans = events.length;
  const layer1Total = sum(events, "layer1_detections_count");
  const layer2Total = sum(events, "layer2_detections_count");
  const pendingLayer3 = events.filter((event) => !event.decision).length;

  setText("total-scans", totalScans);
  setText("layer1-count", layer1Total);
  setText("layer2-count", layer2Total);
  setText("pending-count", pendingLayer3);

  renderBars("severity-bars", countBy(events, (event) => event.severity || "none"), SEVERITIES);
  renderBars("category-bars", categoryCounts(events));
  renderTimeline(events);
  renderHeatmap(events);
  renderTable(events.slice(0, 3));
}

function setText(id, value) {
  document.getElementById(id).textContent = String(value);
}

function sum(events, field) {
  return events.reduce((total, event) => total + Number(event[field] || 0), 0);
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function categoryCounts(events) {
  return events.reduce((counts, event) => {
    const categories = Array.isArray(event.categories) && event.categories.length > 0
      ? event.categories
      : ["Uncategorized"];
    categories.forEach((category) => {
      counts[category] = (counts[category] || 0) + 1;
    });
    return counts;
  }, {});
}

function renderBars(containerId, counts, preferredOrder = null) {
  const container = document.getElementById(containerId);
  const entries = (preferredOrder || Object.keys(counts).sort())
    .map((key) => [key, counts[key] || 0])
    .filter(([, value]) => value > 0 || preferredOrder);
  const max = Math.max(1, ...entries.map(([, value]) => value));

  container.innerHTML = entries.length
    ? entries.map(([key, value]) => `
      <div class="bar-row">
        <span title="${escapeHtml(labelize(key))}">${escapeHtml(labelize(key))}</span>
        <span class="track"><span class="fill ${escapeHtml(key)}" style="width: ${(value / max) * 100}%"></span></span>
        <strong>${value}</strong>
      </div>
    `).join("")
    : '<p class="empty">No detections yet.</p>';
}

function renderTimeline(events) {
  const container = document.getElementById("timeline");
  const days = [];
  const now = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - offset);
    day.setHours(0, 0, 0, 0);
    days.push(day);
  }

  const counts = days.map((day) => {
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    return events.filter((event) => event.timestamp >= day.getTime() && event.timestamp < next.getTime()).length;
  });
  const max = Math.max(1, ...counts);

  container.innerHTML = days.map((day, index) => {
    const value = counts[index];
    return `
      <div class="day" title="${value} scans">
        <span class="day-bar" style="height: ${Math.max(3, (value / max) * 92)}px"></span>
        <span>${day.toLocaleDateString(undefined, { weekday: "short" })}</span>
      </div>
    `;
  }).join("");
}

function renderHeatmap(events) {
  const container = document.getElementById("heatmap");
  const columns = ["Layer 1", "Layer 2", "High+", "Total"];
  const counts = HEATMAP_CATEGORIES.map((category) => {
    const related = events.filter((event) => (event.categories || []).includes(category));
    return {
      category,
      layer1: related.reduce((total, event) => total + Number(event.layer1_detections_count || 0), 0),
      layer2: related.reduce((total, event) => total + Number(event.layer2_detections_count || 0), 0),
      high: related.filter((event) => ["critical", "high"].includes(event.severity)).length,
      total: related.length,
    };
  }).filter((row) => row.total > 0);

  container.innerHTML = [
    '<span></span>',
    ...columns.map((column) => `<span class="heat-label">${column}</span>`),
    ...(counts.length ? counts.flatMap((row) => [
      `<span class="heat-label" title="${escapeHtml(row.category)}">${escapeHtml(row.category)}</span>`,
      heatCell(row.layer1, "l1"),
      heatCell(row.layer2, "l2"),
      heatCell(row.high, row.high > 0 ? "hot" : ""),
      heatCell(row.total, row.total > 2 ? "hot" : ""),
    ]) : ['<span class="empty" style="grid-column: 1 / -1;">No heatmap data yet.</span>']),
  ].join("");
}

function heatCell(value, className) {
  return `<span class="heat-cell ${className}">${value}</span>`;
}

function renderTable(events) {
  const table = document.getElementById("events-table");
  const empty = document.getElementById("empty-state");
  empty.hidden = events.length > 0;

  table.innerHTML = events.map((event) => {
    const categories = Array.isArray(event.categories) && event.categories.length > 0
      ? event.categories.join(", ")
      : "Uncategorized";
    const status = event.decision || "Pending Layer 3";

    return `
      <tr>
        <td title="${formatTime(event.timestamp)}">${formatTime(event.timestamp)}</td>
        <td><span class="severity ${escapeHtml(event.severity || "none")}">${escapeHtml(labelize(event.severity || "none"))}</span></td>
        <td title="${escapeHtml(categories)}">${escapeHtml(categories)}</td>
        <td title="${escapeHtml(status)}">${escapeHtml(status)}</td>
      </tr>
    `;
  }).join("");
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
  download(`preflight-dashboard-${Date.now()}.csv`, [headers.join(","), ...rows].join("\n"), "text/csv");
}

function exportJson(events) {
  download(`preflight-dashboard-${Date.now()}.json`, JSON.stringify(events, null, 2), "application/json");
}

function download(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  if (chrome.downloads?.download) {
    chrome.downloads.download({ url, filename, saveAs: false }, () => {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatTime(timestamp) {
  if (!timestamp) return "Unknown";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = String(value);
  return span.innerHTML;
}
