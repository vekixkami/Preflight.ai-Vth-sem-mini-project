const REQUEST_TIMEOUT_MS = 5_000;
const SETTINGS_KEY = "preflightSettings"; // same key the extension's options page writes
const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export type Summary = {
  total_scans: number;
  layer1_detections: number;
  layer2_detections: number;
  critical_threats: number;
  prevented_sends: number;
  sent_anyway: number;
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

export type ScanEvent = {
  id: number;
  timestamp: string;
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

export type Connection = { apiBaseUrl: string; apiToken: string };

/** Thrown for HTTP 401 / a missing token so the UI can ask for credentials. */
export class AuthError extends Error {}

type ExtensionStorage = {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

// Inside the extension the dashboard shares the options-page settings;
// opened standalone (npm run dev) it falls back to localStorage.
function extensionStorage(): ExtensionStorage | null {
  const storage = (globalThis as { chrome?: { storage?: { local?: ExtensionStorage } } }).chrome?.storage?.local;
  return storage ?? null;
}

export async function loadConnection(): Promise<Connection> {
  let stored: Partial<Connection> = {};
  const storage = extensionStorage();
  if (storage) {
    stored = ((await storage.get([SETTINGS_KEY]))[SETTINGS_KEY] as Partial<Connection>) ?? {};
  } else {
    try {
      stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    } catch {
      stored = {};
    }
  }
  return {
    apiBaseUrl: String(stored.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, ""),
    apiToken: String(stored.apiToken || "").trim(),
  };
}

export async function saveConnection(connection: Connection): Promise<void> {
  const storage = extensionStorage();
  if (storage) {
    const current = ((await storage.get([SETTINGS_KEY]))[SETTINGS_KEY] as Record<string, unknown>) ?? {};
    await storage.set({ [SETTINGS_KEY]: { ...current, ...connection } });
  } else {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(connection));
  }
}

function query(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function request(path: string, filters: Filters = {}): Promise<Response> {
  const { apiBaseUrl, apiToken } = await loadConnection();
  if (!apiToken) throw new AuthError("No API token configured.");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBaseUrl}${path}${query(filters)}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (response.status === 401) throw new AuthError("The backend rejected the API token.");
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function getJson<T>(path: string, filters: Filters = {}): Promise<T> {
  return (await request(path, filters)).json() as Promise<T>;
}

export async function fetchDashboard(filters: Filters) {
  const [summary, categories, severity, timeline, recent] = await Promise.all([
    getJson<Summary>("/api/dashboard/summary", filters),
    getJson<CountItem[]>("/api/dashboard/categories", filters),
    getJson<CountItem[]>("/api/dashboard/severity", filters),
    getJson<TimelinePoint[]>("/api/dashboard/timeline", filters),
    getJson<ScanEvent[]>("/api/dashboard/recent-events", filters),
  ]);
  return { summary, categories, severity, timeline, recent };
}

export async function downloadExport(kind: "csv" | "json", filters: Filters): Promise<Blob> {
  return (await request(`/api/dashboard/export/${kind}`, filters)).blob();
}
