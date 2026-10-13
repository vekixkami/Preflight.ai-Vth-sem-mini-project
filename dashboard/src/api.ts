export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 3_000;

export type Summary = {
  total_scans: number;
  layer1_detections: number;
  layer2_detections: number;
  critical_threats: number;
  average_latency_ms: number;
  backend_status: "online";
  extension_version: string;
  browser_type: string;
  last_telemetry_received: string | null;
};

export type CountItem = { name: string; count: number };

export type TimelinePoint = {
  date: string;
  total_scans: number;
  threats: number;
  layer1_events: number;
  layer2_events: number;
};

export type HeatmapItem = {
  category: string;
  layer1_count: number;
  layer2_count: number;
  critical_count: number;
  total_count: number;
};

export type ScanEvent = {
  id: number;
  timestamp: string;
  input_preview: string;
  layer1_detections: string[];
  layer2_detections: string[];
  severity: "critical" | "high" | "medium" | "low" | "none";
  decision: string | null;
  action_taken: string | null;
  latency_ms: number;
  source: string;
  extension_version: string;
  browser_type: string;
  ai_platform: string;
  domain: string;
  page_title: string;
  input_source: string;
  user_id: string | null;
  device_id: string | null;
  organization_id: string | null;
};

export type Filters = {
  start_date?: string;
  end_date?: string;
  severity?: string;
  layer?: string;
  category?: string;
  browser_type?: string;
  ai_platform?: string;
  domain?: string;
};

function query(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function getJson<T>(path: string, filters: Filters = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}${query(filters)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchDashboard(filters: Filters) {
  const [summary, categories, severity, timeline, heatmap, recent] = await Promise.all([
    getJson<Summary>("/api/dashboard/summary", filters),
    getJson<CountItem[]>("/api/dashboard/categories", filters),
    getJson<CountItem[]>("/api/dashboard/severity", filters),
    getJson<TimelinePoint[]>("/api/dashboard/timeline", filters),
    getJson<HeatmapItem[]>("/api/dashboard/heatmap", filters),
    getJson<ScanEvent[]>("/api/dashboard/recent-events", filters),
  ]);
  return { summary, categories, severity, timeline, heatmap, recent };
}

export function exportUrl(kind: "csv" | "json", filters: Filters) {
  return `${API_BASE_URL}/api/dashboard/export/${kind}${query(filters)}`;
}
