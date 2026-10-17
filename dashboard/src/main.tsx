import React from "react";
import ReactDOM from "react-dom/client";
import { ChevronDown, ChevronRight, Download, Monitor, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./index.css";
import {
  AuthError,
  downloadExport as fetchExport,
  fetchDashboard,
  loadConnection,
  saveConnection,
  type CountItem,
  type Filters,
  type ScanEvent,
  type TimelinePoint,
} from "./api";

type DashboardData = Awaited<ReturnType<typeof fetchDashboard>>;
type LoadError = "auth" | "offline" | null;

// ---------------------------------------------------------------------------
// Appearance: follows the system unless pinned from the header control.
// Applied to <html data-theme> synchronously so charts read the new colors
// in the same render.
// ---------------------------------------------------------------------------

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "preflightDashboardTheme";

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function applyTheme(theme: Theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable: the choice still applies for this visit.
  }
}

applyTheme(readTheme());

// ---------------------------------------------------------------------------
// Vocabulary: show names people recognise, not internal identifiers.
// ---------------------------------------------------------------------------

const DETECTION_LABELS: Record<string, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN",
  gst: "GSTIN",
  ifsc: "IFSC",
  bank_account: "Bank account",
  phone: "Phone number",
  email: "Email",
  openai_key: "OpenAI key",
  anthropic_key: "Anthropic key",
  aws_key: "AWS key",
  jwt: "Access token",
  db_url: "Database URL",
  private_key: "Private key",
  generic_secret: "API secret",
  hardcoded_password: "Password",
  file_reference: "File name",
  env_content: ".env value",
  source_code: "Source code",
  company_keyword: "Company term",
  contract: "Contract",
  financial_report: "Financial report",
  hr_doc: "HR document",
  strategy_doc: "Strategy document",
  customer_data: "Customer data",
};

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  perplexity: "Perplexity",
};

type Tone = "cleared" | "risk" | "high" | "medium" | "neutral";

const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "risk" },
  high: { label: "High", tone: "high" },
  medium: { label: "Medium", tone: "medium" },
  low: { label: "Low", tone: "neutral" },
  none: { label: "None", tone: "neutral" },
};

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  cancelled: { label: "Stopped", tone: "cleared" },
  sanitized: { label: "Rewritten", tone: "cleared" },
  sent_anyway: { label: "Sent anyway", tone: "risk" },
  allowed: { label: "Allowed", tone: "neutral" },
};

const TONE_TEXT: Record<Tone, string> = {
  cleared: "text-cleared",
  risk: "text-risk",
  high: "text-high",
  medium: "text-medium",
  neutral: "text-secondary",
};

const TONE_BG: Record<Tone, string> = {
  cleared: "bg-cleared",
  risk: "bg-risk",
  high: "bg-high",
  medium: "bg-medium",
  neutral: "bg-tertiary",
};

const CATEGORY_OPTIONS = ["PII", "Credentials", "Financial Data", "Business Confidential", "Legal Data", "Other"];
const SEVERITY_FILTERS = ["all", "critical", "high", "medium", "low"];
const LAYER_FILTERS = [
  { value: "all", label: "All" },
  { value: "layer1", label: "Rules" },
  { value: "layer2", label: "ML" },
];

const number = new Intl.NumberFormat();

function detectionName(type: string) {
  return DETECTION_LABELS[type] ?? type.replace(/_/g, " ");
}

function platformName(platform: string) {
  return PLATFORM_LABELS[platform] ?? platform;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [filters, setFilters] = React.useState<Filters>({});
  const [layer, setLayer] = React.useState("all");
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<LoadError>(null);
  const [lastRefresh, setLastRefresh] = React.useState<Date | null>(null);
  const [theme, setThemeState] = React.useState<Theme>(readTheme);
  const setTheme = (next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  };

  const apiFilters = React.useMemo(() => ({ ...filters, layer: layer === "all" ? undefined : layer }), [layer, filters]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchDashboard(apiFilters));
      setLoadError(null);
      setLastRefresh(new Date());
    } catch (error) {
      console.error(error);
      setLoadError(error instanceof AuthError ? "auth" : "offline");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiFilters]);

  React.useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const downloadExport = React.useCallback(async (kind: "csv" | "json") => {
    const blob = await fetchExport(kind, apiFilters);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `preflight-activity.${kind}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [apiFilters]);

  const summary = data?.summary;
  const online = loadError === null && data !== null;
  const firstLoad = loading && !data;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-separator/70 bg-page/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-3">
            <span className="text-[13px] font-semibold text-secondary">Preflight</span>
            <h1 className="text-[17px] font-semibold">Clearance</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeControl value={theme} onChange={setTheme} />
            <ConnectionStatus online={online} loading={firstLoad} error={loadError} lastRefresh={lastRefresh} />
            <button className="btn" onClick={load} disabled={loading}>
              <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <ExportMenu onExport={(kind) => downloadExport(kind).catch((error) => console.error(error))} disabled={!online} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1280px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-6 sm:px-6">
        {loadError && <ConnectionPanel error={loadError} onSaved={load} />}

        {/* Without data there is nothing truthful to show, so only the setup form appears. */}
        {!(loadError && !data) && (
        <>
        <ClearanceSummary summary={summary} loading={firstLoad} />

        <FilterBar filters={filters} setFilters={setFilters} layer={layer} setLayer={setLayer} />

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ActivityTable rows={data?.recent ?? []} loading={firstLoad} />
          <div className="grid content-start gap-5">
            <Breakdown title="Severity" items={severityItems(data?.severity ?? [])} loading={firstLoad} emptyText="No scans in this period." />
            <Breakdown title="What was detected" items={categoryItems(data?.categories ?? [])} loading={firstLoad} emptyText="Nothing detected in this period." />
          </div>
        </div>

        <DailyChart points={data?.timeline ?? []} loading={firstLoad} theme={theme} />
        </>
        )}

        <footer className="flex flex-wrap gap-x-5 gap-y-1 px-1 pb-4 text-[12px] text-secondary">
          <span>Prompt text is never collected — only detection types, severity and the employee's decision.</span>
          {summary && <span className="tabular">Average detection time {Math.round(summary.average_latency_ms)} ms</span>}
          {summary && summary.extension_version !== "unknown" && <span>Extension {summary.extension_version}</span>}
        </footer>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

const THEME_OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "auto", label: "Match system", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

function ThemeControl({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-flex h-8 items-center rounded-lg bg-fill p-0.5">
      {THEME_OPTIONS.map(({ value: option, label, Icon }) => {
        const selected = option === value;
        return (
          <button
            key={option}
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => onChange(option)}
            className={`grid h-7 w-8 place-items-center rounded-md transition-colors ${selected ? "bg-surface text-label shadow-sm" : "text-secondary hover:text-label"}`}
          >
            <Icon aria-hidden className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

function ConnectionStatus({ online, loading, error, lastRefresh }: { online: boolean; loading: boolean; error: LoadError; lastRefresh: Date | null }) {
  const text = loading ? "Connecting…" : online ? `Updated ${lastRefresh ? formatClock(lastRefresh) : ""}` : error === "auth" ? "Not connected" : "Offline";
  return (
    <span className="inline-flex items-center gap-1.5 px-1 text-[13px] text-secondary" role="status">
      <span aria-hidden className={`h-2 w-2 rounded-full ${loading ? "bg-tertiary" : online ? "bg-cleared" : "bg-risk"}`} />
      {text}
    </span>
  );
}

function ExportMenu({ onExport, disabled }: { onExport: (kind: "csv" | "json") => void; disabled: boolean }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const choose = (kind: "csv" | "json") => {
    setOpen(false);
    onExport(kind);
  };
  return (
    <div className="relative" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        <Download aria-hidden className="h-3.5 w-3.5" />
        Export
        <ChevronDown aria-hidden className="h-3.5 w-3.5 text-secondary" />
      </button>
      {open && (
        <div role="menu" className="panel absolute right-0 z-30 mt-1 w-48 p-1 shadow-lg">
          <MenuItem onClick={() => choose("csv")}>Export as CSV</MenuItem>
          <MenuItem onClick={() => choose("json")}>Export as JSON</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="menuitem" className="block w-full rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-fill" onClick={onClick}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Signature: the clearance summary
// ---------------------------------------------------------------------------

function ClearanceSummary({ summary, loading }: { summary: DashboardData["summary"] | undefined; loading: boolean }) {
  if (loading || !summary) {
    return <section className="panel h-[188px] animate-pulse" aria-busy="true" aria-label="Loading summary" />;
  }
  const stopped = summary.prevented_sends;
  const sent = summary.sent_anyway;
  const warned = stopped + sent;
  const clearedShare = warned ? stopped / warned : 0;
  const detections = summary.layer1_detections + summary.layer2_detections;

  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="clearance-heading">
      <h2 id="clearance-heading" className="max-w-3xl text-[22px] font-semibold leading-snug tracking-[-0.01em] sm:text-[26px]">
        {warned === 0 ? (
          "No employee has been warned in this period."
        ) : (
          <>
            <span className="text-cleared tabular">{number.format(stopped)}</span> of{" "}
            <span className="tabular">{number.format(warned)}</span> warned prompts were stopped or rewritten before
            leaving the browser.
          </>
        )}
      </h2>
      {warned > 0 && (
        <div className="mt-4 max-w-3xl">
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-fill"
            role="img"
            aria-label={`${Math.round(clearedShare * 100)} percent of warned prompts were kept in the browser; ${sent} were sent anyway.`}
          >
            <div className="bg-cleared" style={{ width: `${clearedShare * 100}%` }} />
            <div className="bg-risk" style={{ width: `${(1 - clearedShare) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 text-[13px] text-secondary">
            <LegendDot tone="cleared" text={`${Math.round(clearedShare * 100)}% kept in the browser`} />
            <LegendDot tone="risk" text={`${number.format(sent)} sent anyway`} />
          </div>
        </div>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-y-4 border-t border-separator/70 pt-5 sm:grid-cols-4">
        <Stat label="Prompts scanned" value={summary.total_scans} />
        <Stat label="Sensitive items found" value={detections} />
        <Stat label="Critical" value={summary.critical_threats} tone={summary.critical_threats ? "risk" : undefined} />
        <Stat label="Sent despite warning" value={sent} tone={sent ? "risk" : undefined} />
      </dl>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="pr-4">
      <dt className="text-[13px] text-secondary">{label}</dt>
      <dd className={`mt-0.5 text-[22px] font-semibold tabular ${tone ? TONE_TEXT[tone] : ""}`}>{number.format(value)}</dd>
    </div>
  );
}

function LegendDot({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`h-2 w-2 rounded-full ${TONE_BG[tone]}`} />
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FilterBar({ filters, setFilters, layer, setLayer }: { filters: Filters; setFilters: (filters: Filters) => void; layer: string; setLayer: (value: string) => void }) {
  const update = (key: keyof Filters, value: string) => setFilters({ ...filters, [key]: value || undefined });
  const active = Object.values(filters).some(Boolean) || layer !== "all";
  return (
    <section aria-label="Filters" className="flex flex-wrap items-end gap-x-5 gap-y-3 px-1">
      <label className="grid gap-1 text-[12px] text-secondary">
        From
        <input type="date" className="field" value={dateOnly(filters.start_date)} onChange={(event) => update("start_date", event.target.value ? new Date(`${event.target.value}T00:00:00`).toISOString() : "")} />
      </label>
      <label className="grid gap-1 text-[12px] text-secondary">
        To
        <input type="date" className="field" value={dateOnly(filters.end_date)} onChange={(event) => update("end_date", event.target.value ? new Date(`${event.target.value}T23:59:59.999`).toISOString() : "")} />
      </label>
      <Segmented
        label="Severity"
        value={filters.severity ?? "all"}
        options={SEVERITY_FILTERS.map((value) => ({ value, label: value === "all" ? "All" : SEVERITY[value].label }))}
        onChange={(value) => update("severity", value === "all" ? "" : value)}
      />
      <Segmented label="Detected by" value={layer} options={LAYER_FILTERS} onChange={setLayer} />
      <label className="grid gap-1 text-[12px] text-secondary">
        Category
        <select className="field pr-7" value={filters.category ?? ""} onChange={(event) => update("category", event.target.value)}>
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      {active && (
        <button className="h-8 px-1 text-[13px] font-medium text-focus hover:underline" onClick={() => { setFilters({}); setLayer("all"); }}>
          Clear Filters
        </button>
      )}
    </section>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="grid min-w-0 max-w-full gap-1">
      <span className="text-[12px] text-secondary" id={`seg-${label}`}>{label}</span>
      <div role="radiogroup" aria-labelledby={`seg-${label}`} className="inline-flex h-8 max-w-full items-center overflow-x-auto rounded-lg bg-fill p-0.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`h-7 whitespace-nowrap rounded-md px-3 text-[13px] transition-colors ${selected ? "bg-surface font-semibold text-label shadow-sm" : "text-secondary hover:text-label"}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function ActivityTable({ rows, loading }: { rows: ScanEvent[]; loading: boolean }) {
  const [query, setQuery] = React.useState("");
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((row) =>
        [platformName(row.ai_platform), row.domain, OUTCOME[row.decision ?? ""]?.label, SEVERITY[row.severity]?.label, ...detectedNames(row)]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : rows;

  return (
    <section className="panel min-w-0 overflow-hidden" aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
        <h2 id="activity-heading" className="section-title">Recent activity</h2>
        <label className="flex h-8 w-full items-center gap-2 rounded-lg bg-fill px-2.5 text-[13px] sm:w-64">
          <Search aria-hidden className="h-3.5 w-3.5 text-secondary" />
          <span className="sr-only">Search activity</span>
          <input className="w-full bg-transparent outline-none placeholder:text-secondary" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
        </label>
      </div>
      {loading ? (
        <div className="grid gap-2 px-5 pb-5" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-md bg-fill" />)}</div>
      ) : rows.length === 0 ? (
        <Empty text="No scans match these filters yet. Prompts sent on supported AI sites will appear here." />
      ) : visible.length === 0 ? (
        <Empty text={`Nothing matches “${query}”.`} />
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-separator/70 text-[12px] text-secondary">
                <th className="py-2 pl-5 pr-3 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Platform</th>
                <th className="px-3 py-2 font-medium">Detected</th>
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="py-2 pl-3 pr-5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const expanded = expandedId === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr className="border-b border-separator/50 hover:bg-fill/50">
                      <td className="whitespace-nowrap py-2.5 pl-5 pr-3">
                        <button
                          className="inline-flex items-center gap-1 text-secondary tabular hover:text-label"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Hide" : "Show"} details for ${formatTime(row.timestamp)}`}
                          onClick={() => setExpandedId(expanded ? null : row.id)}
                        >
                          {expanded ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
                          {formatTime(row.timestamp)}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{platformName(row.ai_platform)}</td>
                      <td className="px-3 py-2.5">{detectedNames(row).join(", ") || <span className="text-secondary">Nothing sensitive</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5"><SeverityLabel severity={row.severity} /></td>
                      <td className="whitespace-nowrap py-2.5 pl-3 pr-5"><OutcomeLabel decision={row.decision} /></td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-separator/50 bg-fill/40">
                        <td colSpan={5} className="px-5 py-3">
                          <dl className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
                            <Detail label="Site" value={row.domain} />
                            <Detail label="Entered by" value={row.input_source === "clipboard" ? "Paste" : row.input_source === "upload" ? "File upload" : "Typing"} />
                            <Detail label="Detection time" value={`${Math.round(row.latency_ms)} ms`} />
                            <Detail label="Rules found" value={row.layer1_detections.map(detectionName).join(", ") || "None"} />
                            <Detail label="ML classified as" value={row.layer2_detections.map(detectionName).join(", ") || "Not sensitive"} />
                            <Detail label="Extension" value={row.extension_version} />
                          </dl>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function detectedNames(row: ScanEvent) {
  return [...new Set([...row.layer1_detections, ...row.layer2_detections])].map(detectionName);
}

function SeverityLabel({ severity }: { severity: string }) {
  const meta = SEVERITY[severity] ?? SEVERITY.none;
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${TONE_TEXT[meta.tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONE_BG[meta.tone]}`} />
      {meta.label}
    </span>
  );
}

function OutcomeLabel({ decision }: { decision: string | null }) {
  const meta = decision ? OUTCOME[decision] : undefined;
  if (!meta) return <span className="text-secondary">—</span>;
  return <span className={`font-medium ${TONE_TEXT[meta.tone]}`}>{meta.label}</span>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-secondary">{label}</dt>
      <dd className="truncate" title={value}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdowns and chart
// ---------------------------------------------------------------------------

type BreakdownItem = { name: string; count: number; tone: Tone };

function severityItems(items: CountItem[]): BreakdownItem[] {
  const counts = new Map(items.map((item) => [item.name, item.count]));
  return ["critical", "high", "medium", "low"].map((name) => ({ name: SEVERITY[name].label, count: counts.get(name) ?? 0, tone: SEVERITY[name].tone }));
}

function categoryItems(items: CountItem[]): BreakdownItem[] {
  return [...items].filter((item) => item.count > 0).sort((a, b) => b.count - a.count).map((item) => ({ ...item, tone: "neutral" as Tone }));
}

function Breakdown({ title, items, loading, emptyText }: { title: string; items: BreakdownItem[]; loading: boolean; emptyText: string }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <section className="panel p-5" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      {loading ? (
        <div className="mt-4 grid gap-3" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-5 animate-pulse rounded bg-fill" />)}</div>
      ) : total === 0 ? (
        <p className="mt-3 text-[13px] text-secondary">{emptyText}</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {items.map((item) => (
            <li key={item.name} className="grid gap-1">
              <div className="flex items-baseline justify-between text-[13px]">
                <span>{item.name}</span>
                <span className="tabular text-secondary">{number.format(item.count)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-fill" aria-hidden>
                <div className={`h-full rounded-full ${TONE_BG[item.tone]}`} style={{ width: `${(item.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function useTokenColors(theme: Theme) {
  const read = () => {
    const style = getComputedStyle(document.documentElement);
    const rgb = (name: string) => `rgb(${style.getPropertyValue(`--${name}`).trim().split(/\s+/).join(",")})`;
    return { neutral: rgb("chart-neutral"), risk: rgb("risk"), grid: rgb("separator"), axis: rgb("secondary"), surface: rgb("surface"), label: rgb("label") };
  };
  const [systemDark, setSystemDark] = React.useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return React.useMemo(read, [theme, systemDark]);
}

function DailyChart({ points, loading, theme }: { points: TimelinePoint[]; loading: boolean; theme: Theme }) {
  const colors = useTokenColors(theme);
  const reduceMotion = React.useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const totalScans = points.reduce((sum, point) => sum + point.total_scans, 0);
  const totalFlagged = points.reduce((sum, point) => sum + point.threats, 0);
  const busiest = points.reduce<TimelinePoint | null>((best, point) => (!best || point.threats > best.threats ? point : best), null);
  const data = points.map((point) => ({ ...point, label: formatDay(point.date) }));

  return (
    <section className="panel p-5" aria-labelledby="daily-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="daily-heading" className="section-title">Prompts per day</h2>
        <div className="flex gap-4 text-[13px] text-secondary">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: colors.neutral }} />Scanned</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-sm bg-risk" />High or critical</span>
        </div>
      </div>
      {!loading && points.length > 0 && (
        <p className="mt-1 text-[13px] text-secondary">
          {number.format(totalFlagged)} of {number.format(totalScans)} scans were high or critical
          {busiest && busiest.threats > 0 ? `, most on ${formatDay(busiest.date)}.` : "."}
        </p>
      )}
      {loading ? (
        <div className="mt-4 h-[240px] animate-pulse rounded-lg bg-fill" aria-busy="true" />
      ) : points.length === 0 ? (
        <p className="mt-3 text-[13px] text-secondary">No scans in this period.</p>
      ) : (
        <div className="mt-4 h-[240px]" role="img" aria-label={`Bar chart of prompts scanned per day; ${totalFlagged} of ${totalScans} were high or critical.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={colors.grid} strokeOpacity={0.6} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: colors.axis, fontSize: 12 }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={{ fill: colors.axis, fontSize: 12 }} />
              <Tooltip
                cursor={{ fill: colors.grid, fillOpacity: 0.35 }}
                contentStyle={{ background: colors.surface, border: `1px solid ${colors.grid}`, borderRadius: 10, color: colors.label, fontSize: 13 }}
                labelStyle={{ color: colors.label, fontWeight: 600 }}
              />
              <Bar dataKey="total_scans" name="Scanned" fill={colors.neutral} radius={[4, 4, 0, 0]} isAnimationActive={!reduceMotion} />
              <Bar dataKey="threats" name="High or critical" fill={colors.risk} radius={[4, 4, 0, 0]} isAnimationActive={!reduceMotion} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Connection setup (shown only when the backend rejects or can't be reached)
// ---------------------------------------------------------------------------

function ConnectionPanel({ error, onSaved }: { error: Exclude<LoadError, null>; onSaved: () => void }) {
  const [apiBaseUrl, setApiBaseUrl] = React.useState("");
  const [apiToken, setApiToken] = React.useState("");
  React.useEffect(() => {
    loadConnection().then((connection) => {
      setApiBaseUrl(connection.apiBaseUrl);
      setApiToken(connection.apiToken);
    });
  }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    await saveConnection({ apiBaseUrl: apiBaseUrl.trim().replace(/\/+$/, ""), apiToken: apiToken.trim() });
    onSaved();
  };
  return (
    <section className="panel p-5" aria-labelledby="connect-heading">
      <h2 id="connect-heading" className="section-title">{error === "auth" ? "Connect to your Preflight backend" : "Can’t reach the backend"}</h2>
      <p className="mt-1 text-[13px] text-secondary">
        {error === "auth"
          ? "Enter the API token for your organisation. It’s shared with the extension’s Settings page."
          : "Check that the backend is running and the address below is correct."}
      </p>
      <form className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={save}>
        <label className="grid gap-1 text-[12px] text-secondary">
          Backend URL
          <input className="field h-9" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="http://localhost:8000" />
        </label>
        <label className="grid gap-1 text-[12px] text-secondary">
          API token
          <input className="field h-9" type="password" autoComplete="off" value={apiToken} onChange={(event) => setApiToken(event.target.value)} />
        </label>
        <button type="submit" className="btn h-9 self-end border-transparent bg-label text-surface hover:bg-label/85">Connect</button>
      </form>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 pb-8 pt-4 text-[13px] text-secondary">{text}</p>;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function dateOnly(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatClock(value: Date) {
  return value.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDay(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
