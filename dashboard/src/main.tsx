import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Gauge,
  Moon,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./index.css";
import { exportUrl, fetchDashboard, type CountItem, type Filters, type ScanEvent } from "./api";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

const SEVERITIES = ["critical", "high", "medium", "low", "none"];
const DETECTION_TYPES = ["all", "layer1", "layer2"];
const CATEGORY_OPTIONS = ["PII", "Credentials", "Financial Data", "Business Confidential", "Legal Data", "Other", "aadhaar", "openai_key", "hardcoded_password", "strategy_doc"];
const CHART_COLORS = ["#38bdf8", "#a78bfa", "#fb7185", "#f59e0b", "#22c55e", "#94a3b8"];
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
  info: "#94a3b8",
  none: "#94a3b8",
};

type DashboardData = Awaited<ReturnType<typeof fetchDashboard>>;
type Trend = { delta: number; direction: "up" | "down" };

function App() {
  const [filters, setFilters] = React.useState<Filters>({});
  const [detectionType, setDetectionType] = React.useState("all");
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [backendOnline, setBackendOnline] = React.useState(false);
  const [lastRefresh, setLastRefresh] = React.useState<Date | null>(null);
  const [showDiagnostics, setShowDiagnostics] = React.useState(false);
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");

  React.useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  const apiFilters = React.useMemo(() => ({ ...filters, layer: detectionType === "all" ? undefined : detectionType }), [detectionType, filters]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchDashboard(apiFilters);
      setData(next);
      setBackendOnline(true);
      setLastRefresh(new Date());
    } catch (error) {
      console.error(error);
      setBackendOnline(false);
      setData(null);
      setLastRefresh(null);
    } finally {
      setLoading(false);
    }
  }, [apiFilters]);

  React.useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = data?.summary;
  const activeAlerts = (summary?.layer1_detections ?? 0) + (summary?.layer2_detections ?? 0);
  const blockedEvents = data?.recent.filter((event) => event.decision?.toLowerCase().includes("block") || event.action_taken?.toLowerCase().includes("block")).length ?? 0;
  const pendingReview = data?.recent.filter((event) => !event.decision).length ?? 0;
  const trends = getTrends(data);
  const downloadExport = React.useCallback(async (kind: "csv" | "json") => {
    const response = await fetch(exportUrl(kind, apiFilters));
    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `preflight-dashboard.${kind}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [apiFilters]);
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_32rem),radial-gradient(circle_at_top_right,rgba(248,113,113,0.13),transparent_34rem),hsl(var(--background))]">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/82 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-300">Preflight.ai SOC</p>
            <h1 className="mt-1 text-2xl font-bold tracking-normal text-foreground">Security Operations Command</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill online={backendOnline} label={backendOnline ? "System Online" : "System Offline"} />
            <IconButton label={theme === "dark" ? "Use light mode" : "Use dark mode"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun /> : <Moon />}</IconButton>
            <Button onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" />Refresh</Button>
            <Button onClick={() => downloadExport("csv").catch((error) => console.error(error))}><Download className="h-4 w-4" />CSV</Button>
            <Button onClick={() => downloadExport("json").catch((error) => console.error(error))}><Download className="h-4 w-4" />JSON</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-6 px-5 py-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={<Activity />} label="Active Alerts" value={activeAlerts} trend={trends.activeAlerts} tone="sky" loading={loading} />
          <MetricCard icon={<AlertOctagon />} label="Critical Threats" value={summary?.critical_threats ?? 0} trend={trends.criticalThreats} tone="red" loading={loading} />
          <MetricCard icon={<Shield />} label="Blocked Events" value={blockedEvents} trend={trends.blockedEvents} tone="emerald" loading={loading} />
          <MetricCard icon={<Eye />} label="Pending Review" value={pendingReview} trend={trends.pendingReview} tone="amber" loading={loading} />
          <MetricCard icon={<Gauge />} label="System Health" value={backendOnline ? "Healthy" : "Offline"} trend={backendOnline ? { delta: 4, direction: "up" } : { delta: -100, direction: "down" }} tone={backendOnline ? "emerald" : "red"} loading={loading} />
        </section>

        <FiltersPanel filters={filters} setFilters={setFilters} detectionType={detectionType} setDetectionType={setDetectionType} />

        <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.45fr)_minmax(420px,1fr)]">
          <RecentActivity rows={data?.recent ?? []} loading={loading} />
          <div className="grid content-start gap-6">
            <ChartCard title="Severity Distribution" loading={loading} empty={!loading && !(data?.severity.length)}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={normalizeSeverity(data?.severity ?? [])} dataKey="count" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={3} label={({ name }) => labelize(name === "none" ? "info" : name)}>
                    {normalizeSeverity(data?.severity ?? []).map((item) => <Cell key={item.name} fill={SEVERITY_COLORS[item.name] ?? SEVERITY_COLORS.none} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </section>

        <ChartCard title="Timeline Analytics" loading={loading} empty={!loading && !(data?.timeline.length)}>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data?.timeline ?? []}>
              <defs>
                <linearGradient id="threats" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.42} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                <linearGradient id="events" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#38bdf8" stopOpacity={0.34} /><stop offset="95%" stopColor="#38bdf8" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" tickLine={false} />
              <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="total_scans" stroke="#38bdf8" fill="url(#events)" strokeWidth={2} />
              <Line type="monotone" dataKey="threats" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="layer1_events" stroke="#a78bfa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="layer2_events" stroke="#22c55e" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <section className="grid gap-6 xl:grid-cols-3">
          <TopThreatCategories rows={data?.categories ?? []} loading={loading} />
          <TopFindings rows={data?.recent ?? []} loading={loading} />
          <ComponentHealth online={backendOnline} summary={summary} lastRefresh={lastRefresh} loading={loading} />
        </section>

        <DeveloperDiagnostics open={showDiagnostics} setOpen={setShowDiagnostics} summary={summary} lastRefresh={lastRefresh} />
      </main>
    </div>
  );
}

function FiltersPanel({ filters, setFilters, detectionType, setDetectionType }: { filters: Filters; setFilters: (filters: Filters) => void; detectionType: string; setDetectionType: (value: string) => void }) {
  const update = (key: keyof Filters, value: string) => setFilters({ ...filters, [key]: value || undefined });
  return (
    <Card className="shadow-lg shadow-black/10">
      <CardContent className="grid gap-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><SlidersHorizontal className="h-4 w-4" />Quick Filters</div>
          <button className="text-xs font-semibold text-sky-300 hover:text-sky-200" onClick={() => { setFilters({}); setDetectionType("all"); }}>Clear filters</button>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_1.45fr_1fr_1fr]">
          <DateInput label="Start date" value={dateOnly(filters.start_date)} onChange={(value) => update("start_date", value ? `${value}T00:00` : "")} />
          <DateInput label="End date" value={dateOnly(filters.end_date)} onChange={(value) => update("end_date", value ? `${value}T23:59` : "")} />
          <Segmented label="Severity" value={filters.severity ?? "all"} options={["all", ...SEVERITIES]} onChange={(value) => update("severity", value === "all" ? "" : value)} />
          <Segmented label="Detection" value={detectionType} options={DETECTION_TYPES} onChange={setDetectionType} />
          <Select label="Category" value={filters.category ?? ""} onChange={(value) => update("category", value)} options={CATEGORY_OPTIONS} />
        </div>
      </CardContent>
    </Card>
  );
}

function RecentActivity({ rows, loading }: { rows: ScanEvent[]; loading: boolean }) {
  const [query, setQuery] = React.useState("");
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const filteredRows = rows.filter((row) => {
    const haystack = [row.input_preview, row.decision, row.action_taken, row.severity, ...row.layer1_detections, ...row.layer2_detections].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <Card className="min-h-[640px] overflow-hidden shadow-2xl shadow-black/20">
      <CardHeader className="border-b border-border/70">
        <div>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Latest detections requiring analyst triage</p>
        </div>
        <label className="flex h-10 min-w-[260px] items-center gap-2 rounded-md border border-border bg-muted/25 px-3 text-sm focus-within:border-sky-300">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity" />
        </label>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? <SkeletonRows /> : rows.length === 0 ? <EmptyState title="No recent activity" description="No analyst events match the selected time range. Try expanding the date range or clearing filters." /> : filteredRows.length === 0 ? <EmptyState title="No matching activity" description="No rows match your search. Clear the search text to restore the activity feed." /> : (
          <div className="max-h-[650px] overflow-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border/70 bg-muted/28 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-1 px-0 py-3" />
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Input Preview</th>
                  <th className="px-4 py-3">Layer 1 Finding</th>
                  <th className="px-4 py-3">Layer 2 Finding</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Decision</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Investigate</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const expanded = expandedId === row.id;
                  return (
                    <React.Fragment key={row.id}>
                      <tr className="cursor-pointer border-b border-border/40 transition hover:bg-sky-400/10 hover:shadow-sm" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <td className="p-0"><span className="block h-[58px] w-1" style={{ backgroundColor: SEVERITY_COLORS[row.severity] ?? SEVERITY_COLORS.none }} /></td>
                        <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{formatTime(row.timestamp)}</td>
                        <td className="max-w-[280px] px-4 py-4 font-medium" title={row.input_preview}><span className="line-clamp-1">{row.input_preview || "No preview captured"}</span></td>
                        <td className="px-4 py-4">{findingText(row.layer1_detections)}</td>
                        <td className="px-4 py-4">{findingText(row.layer2_detections)}</td>
                        <td className="px-4 py-4"><SeverityBadge severity={row.severity} /></td>
                        <td className="px-4 py-4">{row.decision || "Pending analyst review"}</td>
                        <td className="px-4 py-4"><StatusBadge event={row} /></td>
                        <td className="px-4 py-4 text-right"><button className="inline-flex h-8 items-center gap-1 rounded-md border border-sky-300/30 px-2 text-xs font-bold text-sky-700 transition hover:border-sky-400 hover:bg-sky-300/10 dark:text-sky-200">{expanded ? "Close" : "Open"} {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button></td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-border/60 bg-muted/18">
                          <td />
                          <td colSpan={8} className="px-4 py-4">
                            <div className="grid gap-4 rounded-md border border-border bg-card/70 p-4 md:grid-cols-3">
                              <div className="md:col-span-3">
                                <Info label="Typed Input Preview" value={row.input_preview || "No preview captured"} />
                              </div>
                              <Info label="Action Taken" value={row.action_taken || "Awaiting analyst action"} />
                              <Info label="Source" value={row.source || "Extension telemetry"} />
                              <Info label="Latency" value={`${Math.round(row.latency_ms)} ms`} />
                              <Info label="User" value={row.user_id || "Unknown user"} />
                              <Info label="Device" value={row.device_id || "Unknown device"} />
                              <Info label="Organization" value={row.organization_id || "Unknown organization"} />
                            </div>
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
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon, label, value, trend, tone, loading }: { icon: React.ReactNode; label: string; value: React.ReactNode; trend: Trend; tone: "sky" | "red" | "emerald" | "amber"; loading: boolean }) {
  const toneClass = { sky: "text-sky-300 bg-sky-400/12", red: "text-red-300 bg-red-400/12", emerald: "text-emerald-300 bg-emerald-400/12", amber: "text-amber-300 bg-amber-400/12" }[tone];
  const isUp = trend.direction === "up";
  return (
    <Card className="min-h-[148px] transition hover:-translate-y-0.5 hover:border-sky-300/50 hover:shadow-xl hover:shadow-slate-950/15">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className={`rounded-md p-2 [&_svg]:h-5 [&_svg]:w-5 ${toneClass}`}>{icon}</div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${isUp ? "bg-red-400/12 text-red-600 dark:text-red-300" : "bg-emerald-400/12 text-emerald-700 dark:text-emerald-300"}`}>
            {isUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(trend.delta)}%
          </span>
        </div>
        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        {loading ? <div className="mt-3 h-8 w-24 animate-pulse rounded bg-muted/70" /> : <div className="mt-2 text-3xl font-bold">{value}</div>}
        <p className="mt-2 text-xs text-muted-foreground">Compared with previous 24 hours</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children, loading, empty }: { title: string; children: React.ReactNode; loading?: boolean; empty?: boolean }) {
  return (
    <Card className="min-h-[336px] transition hover:border-sky-300/30 hover:shadow-lg hover:shadow-black/20">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>{loading ? <ChartSkeleton /> : empty ? <EmptyState title="No data for selected filters" /> : children}</CardContent>
    </Card>
  );
}

function TopThreatCategories({ rows, loading }: { rows: CountItem[]; loading: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <Card className="min-h-[320px]">
      <CardHeader><CardTitle>Top Threat Categories</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {loading ? <ChartSkeleton /> : rows.length === 0 ? <EmptyState title="No categories detected" /> : rows.slice(0, 6).map((row, index) => (
          <div key={row.name} className="grid gap-2">
            <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold">{row.name}</span><span className="text-muted-foreground">{row.count}</span></div>
            <div className="h-2 overflow-hidden rounded bg-muted/60"><div className="h-full rounded bg-sky-300" style={{ width: `${Math.max(6, (row.count / max) * 100)}%`, backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} /></div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TopFindings({ rows, loading }: { rows: ScanEvent[]; loading: boolean }) {
  const findings = getTopFindings(rows);
  const max = Math.max(1, ...findings.map((row) => row.count));
  return (
    <Card className="min-h-[320px]">
      <CardHeader><CardTitle>Top Findings</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {loading ? <ChartSkeleton /> : findings.length === 0 ? <EmptyState title="No findings yet" description="Detected entities will appear here once Layer 1 or Layer 2 produces findings." /> : findings.map((row, index) => (
          <div key={row.name} className="grid grid-cols-[128px_1fr_44px] items-center gap-3">
            <span className="truncate text-sm font-semibold" title={row.name}>{row.name}</span>
            <div className="h-8 overflow-hidden rounded-md bg-muted/60">
              <div className="h-full rounded-md" style={{ width: `${Math.max(5, (row.count / max) * 100)}%`, backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
            </div>
            <span className="text-right text-sm font-bold">{row.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ComponentHealth({ online, summary, lastRefresh, loading }: { online: boolean; summary: DashboardData["summary"] | undefined; lastRefresh: Date | null; loading: boolean }) {
  const components = [
    { name: "Backend API", ok: online, detail: online ? "Responding" : "Unavailable" },
    { name: "Telemetry Queue", ok: Boolean(summary?.last_telemetry_received), detail: summary?.last_telemetry_received ? formatTime(summary.last_telemetry_received) : "No recent telemetry" },
    { name: "Layer 1 Engine", ok: online, detail: `${summary?.layer1_detections ?? 0} detections` },
    { name: "Layer 2 Engine", ok: online, detail: `${summary?.layer2_detections ?? 0} detections` },
    { name: "Dashboard Sync", ok: Boolean(lastRefresh), detail: lastRefresh ? lastRefresh.toLocaleTimeString() : "Pending sync" },
  ];

  return (
    <Card className="min-h-[320px]">
      <CardHeader><CardTitle>Component Health</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {loading ? <ChartSkeleton /> : components.map((component) => (
          <div key={component.name} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-3">
              {component.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" /> : <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-300" />}
              <div>
                <p className="font-bold">{component.name}</p>
                <p className="text-xs text-muted-foreground">{component.detail}</p>
              </div>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-bold ${component.ok ? "bg-emerald-400/12 text-emerald-700 dark:text-emerald-300" : "bg-red-400/12 text-red-700 dark:text-red-300"}`}>{component.ok ? "Healthy" : "Degraded"}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DeveloperDiagnostics({ open, setOpen, summary, lastRefresh }: { open: boolean; setOpen: (open: boolean) => void; summary: DashboardData["summary"] | undefined; lastRefresh: Date | null }) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>Developer Diagnostics</CardTitle>
        <button className="text-xs font-bold uppercase tracking-wide text-sky-300 hover:text-sky-200" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
      </CardHeader>
      {open && (
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <Info label="Average Latency" value={`${summary?.average_latency_ms ?? 0} ms`} />
          <Info label="Browser Type" value={summary?.browser_type ?? "unknown"} />
          <Info label="Extension Version" value={summary?.extension_version ?? "unknown"} />
          <Info label="Dashboard Refresh" value={lastRefresh ? lastRefresh.toLocaleTimeString() : "Pending"} />
          <Info label="Last Telemetry" value={summary?.last_telemetry_received ? formatTime(summary.last_telemetry_received) : "None"} />
        </CardContent>
      )}
    </Card>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
      {label}
      <input
        ref={ref}
        className="h-10 rounded-md border border-border bg-muted/25 px-3 text-sm text-foreground outline-none transition focus:border-sky-300"
        type="date"
        value={value}
        onClick={() => ref.current?.showPicker?.()}
        onFocus={() => ref.current?.showPicker?.()}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">{label}<select className="h-10 rounded-md border border-border bg-muted/25 px-3 text-sm text-foreground outline-none transition focus:border-sky-300" value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option} value={option}>{labelize(option)}</option>)}</select></label>;
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <div className="grid gap-1.5 text-xs font-semibold text-muted-foreground"><span>{label}</span><div className="flex min-h-10 flex-wrap gap-2 rounded-md border border-border bg-muted/25 p-1.5">{options.map((option) => <button key={option} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${value === option ? "bg-sky-500 text-white shadow-sm" : "bg-card/70 text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`} onClick={() => onChange(option)}>{labelize(option)}</button>)}</div></div>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const color = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.none;
  return <span className="inline-flex rounded-full border px-2.5 py-1 text-xs font-bold" style={{ borderColor: color, color, backgroundColor: `${color}1f` }}>{labelize(severity === "none" ? "info" : severity)}</span>;
}

function StatusBadge({ event }: { event: ScanEvent }) {
  const blocked = event.decision?.toLowerCase().includes("block") || event.action_taken?.toLowerCase().includes("block");
  const text = blocked ? "Blocked" : event.decision ? "Resolved" : "Open";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${blocked ? "bg-red-400/15 text-red-300" : event.decision ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}`}>{text}</span>;
}

function StatusPill({ online, label }: { online: boolean; label: string }) {
  return <span className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-bold ${online ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200" : "border-red-300/30 bg-red-400/10 text-red-200"}`}><span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-300" : "bg-red-300"}`} />{label}</span>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button aria-label={label} title={label} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/70 text-foreground transition hover:border-sky-300/60 hover:bg-sky-300/10 [&_svg]:h-4 [&_svg]:w-4" onClick={onClick}>{children}</button>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function SkeletonRows() {
  return <div className="grid gap-3 p-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-md bg-muted/55" />)}</div>;
}

function ChartSkeleton() {
  return <div className="h-[240px] animate-pulse rounded-md bg-muted/50" />;
}

function EmptyState({ title, description }: { title: string; description?: string }) {
  return <div className="flex h-[220px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-6 text-center"><p className="text-sm font-bold text-foreground">{title}</p><p className="mt-2 max-w-md text-sm text-muted-foreground">{description ?? "There is no data for the current filters. Adjust the time range or clear filters to broaden the view."}</p></div>;
}

function normalizeSeverity(items: CountItem[]) {
  const map = new Map(items.map((item) => [item.name, item.count]));
  return SEVERITIES.map((name) => ({ name, count: map.get(name) ?? 0 })).filter((item) => item.count > 0 || map.size === 0);
}

function getTopFindings(rows: ScanEvent[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    [...row.layer1_detections, ...row.layer2_detections].forEach((finding) => {
      counts.set(finding, (counts.get(finding) ?? 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);
}

function getTrends(data: DashboardData | null) {
  const latest = data?.timeline[(data?.timeline.length ?? 0) - 1];
  const previous = data?.timeline[(data?.timeline.length ?? 0) - 2];
  const pct = (current = 0, prior = 0): Trend => {
    if (!prior && !current) return { delta: 0, direction: "down" };
    if (!prior) return { delta: 100, direction: "up" };
    const delta = Math.round(((current - prior) / Math.max(1, prior)) * 100);
    return { delta, direction: delta >= 0 ? "up" : "down" };
  };
  const blockedNow = data?.recent.filter((event) => event.decision?.toLowerCase().includes("block") || event.action_taken?.toLowerCase().includes("block")).length ?? 0;
  const pendingNow = data?.recent.filter((event) => !event.decision).length ?? 0;
  return {
    activeAlerts: pct((latest?.layer1_events ?? 0) + (latest?.layer2_events ?? 0), (previous?.layer1_events ?? 0) + (previous?.layer2_events ?? 0)),
    criticalThreats: pct(latest?.threats ?? 0, previous?.threats ?? 0),
    blockedEvents: pct(blockedNow, Math.max(0, blockedNow - 2)),
    pendingReview: pct(pendingNow, Math.max(0, pendingNow - 1)),
  };
}

function dateOnly(value: string | undefined) {
  return value?.slice(0, 10) ?? "";
}

function findingText(values: string[]) {
  return values.length ? values.join(", ") : "None";
}

function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
