"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { button, card, ghost, input, num, td, th } from "./styles";
import ProfilesPanel, { type AdminProfile } from "./ProfilesPanel";
import BarChart, { buildSeries, type Period } from "./BarChart";

type Application = {
  id: string;
  time: string;
  profile: string;
  company: string;
  role: string;
  filename: string;
  ip: string;
  link?: string;
};
type Profile = AdminProfile;

/** Only http(s) links are made clickable. */
const safeLink = (s?: string) => (s && /^https?:\/\//i.test(s) ? s : "");
type ImportItem = { company: string; role: string; filename: string; time: string };

/**
 * Read company and role from a downloaded resume file name:
 * "Certta_Fullstack Engineer - Pleno - Wellington Souza.pdf"
 *   -> company "Certta", role "Fullstack Engineer - Pleno".
 * Long names were cut at 80 characters, so the " - <Name>" ending may be
 * partial or missing. The time is the file's date (when it was saved).
 */
function parseResumeFile(file: File, profileName: string): ImportItem | null {
  if (!/\.pdf$/i.test(file.name)) return null;
  let base = file.name.replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "").trim(); // drop " (1)" copies
  const name = profileName.toLowerCase();
  const cut = base.lastIndexOf(" - ");
  if (cut >= 0 && name) {
    const tail = base.slice(cut + 3).trim().toLowerCase();
    if (tail && name.startsWith(tail)) base = base.slice(0, cut);
  }
  base = base.replace(/\s+-\s*$/, "").trim();
  const us = base.indexOf("_");
  const company = (us >= 0 ? base.slice(0, us) : base).trim();
  const role = us >= 0 ? base.slice(us + 1).trim() : "";
  if (!company) return null;
  return { company, role, filename: file.name, time: new Date(file.lastModified).toISOString() };
}

const KEY_STORAGE = "resume-tailor-admin-key";
const DAYS_SHOWN = 14;
const WEEKS_SHOWN = 8;
const MONTHS_SHOWN = 12;
type ChartMode = "day" | "week" | "month";
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// ---- dates (browser's local time; weeks start on Monday) ----
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtShort = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function titleCase(id: string): string {
  return id.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function readKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}
function writeKey(v: string | null) {
  try {
    if (v) sessionStorage.setItem(KEY_STORAGE, v);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage blocked: stay logged in for this page view only */
  }
}

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [apps, setApps] = useState<Application[] | null>(null);
  // "super": full access; "admin": view counts/history and export only.
  const [role, setRole] = useState<"super" | "admin">("admin");
  const [chartMode, setChartMode] = useState<ChartMode>("day");
  // Profiles hidden in the chart by clicking their legend entry.
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const toggleSeries = (id: string) =>
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterProfile, setFilterProfile] = useState("");
  const [filterText, setFilterText] = useState("");
  const [listLimit, setListLimit] = useState(50);
  // Import past resumes (made before counting existed) from their PDF file names.
  const [importProfile, setImportProfile] = useState("");
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async (k: string) => {
    if (!k) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applications", { headers: { "x-admin-key": k }, cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        writeKey(null);
        setKey("");
        setApps(null);
        setError("Wrong admin password");
        return;
      }
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setApps(data.applications ?? []);
      setRole(data.role === "super" ? "super" : "admin");
      writeKey(k);
      setKey(k);
      const pr = await fetch("/api/admin/profiles", { headers: { "x-admin-key": k }, cache: "no-store" });
      const pd = await pr.json().catch(() => ({}));
      if (pr.ok && Array.isArray(pd?.profiles)) setProfiles(pd.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = readKey();
    if (saved) load(saved);
  }, [load]);

  // Auto-refresh every minute while the page is open.
  useEffect(() => {
    if (!key) return;
    const t = setInterval(() => load(key), 60000);
    return () => clearInterval(t);
  }, [key, load]);

  /** Profiles from resumes/*.md plus any that only appear in the log. */
  const allProfiles = useMemo<Profile[]>(() => {
    const map = new Map(profiles.map((p) => [p.id, p.name]));
    for (const a of apps ?? []) if (!map.has(a.profile)) map.set(a.profile, titleCase(a.profile));
    return Array.from(map, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, apps]);

  const stats = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const yesterday = addDays(today, -1);
    const week = startOfWeek(now);
    const lastWeek = addDays(week, -7);
    const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, -i));
    const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(week, -7 * i));

    type Row = { today: number; yesterday: number; week: number; lastWeek: number; total: number; byDay: Record<string, number>; byWeek: Record<string, number> };
    const blank = (): Row => ({ today: 0, yesterday: 0, week: 0, lastWeek: 0, total: 0, byDay: {}, byWeek: {} });
    const per: Record<string, Row> = {};
    const all = blank();

    for (const a of apps ?? []) {
      const t = new Date(a.time);
      const dk = dayKey(startOfDay(t));
      const wk = dayKey(startOfWeek(t));
      for (const r of [(per[a.profile] ??= blank()), all]) {
        r.total++;
        if (t >= today) r.today++;
        else if (t >= yesterday) r.yesterday++;
        if (t >= week) r.week++;
        else if (t >= lastWeek) r.lastWeek++;
        r.byDay[dk] = (r.byDay[dk] ?? 0) + 1;
        r.byWeek[wk] = (r.byWeek[wk] ?? 0) + 1;
      }
    }
    return { per, all, days, weeks, blank };
  }, [apps]);

  /** Bars for the chart: oldest period on the left. */
  const chart = useMemo(() => {
    const { series, seriesOf } = buildSeries(allProfiles);
    const now = new Date();
    let periods: Period[] = [];
    let keyOf: (t: Date) => string;
    if (chartMode === "day") {
      const today = startOfDay(now);
      periods = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, i - DAYS_SHOWN + 1)).map((d) => ({
        key: dayKey(d),
        label: fmtShort(d),
        tip: fmtDay(d),
        counts: {},
      }));
      keyOf = (t) => dayKey(startOfDay(t));
    } else if (chartMode === "week") {
      const week = startOfWeek(now);
      periods = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(week, -7 * (WEEKS_SHOWN - 1 - i))).map((w) => ({
        key: dayKey(w),
        label: fmtShort(w),
        tip: `${fmtShort(w)} – ${fmtShort(addDays(w, 6))}`,
        counts: {},
      }));
      keyOf = (t) => dayKey(startOfWeek(t));
    } else {
      periods = Array.from({ length: MONTHS_SHOWN }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1 - i), 1)).map((m) => ({
        key: monthKey(m),
        label: m.toLocaleDateString(undefined, { month: "short", ...(m.getMonth() === 0 ? { year: "2-digit" } : {}) }),
        tip: m.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        counts: {},
      }));
      keyOf = monthKey;
    }
    const byKey = new Map(periods.map((p) => [p.key, p]));
    for (const a of apps ?? []) {
      const p = byKey.get(keyOf(new Date(a.time)));
      if (!p) continue;
      const s = seriesOf(a.profile);
      p.counts[s] = (p.counts[s] ?? 0) + 1;
    }
    return { series, periods };
  }, [apps, allProfiles, chartMode]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return (apps ?? []).filter(
      (a) =>
        (!filterProfile || a.profile === filterProfile) &&
        (!q || `${a.company} ${a.role} ${a.ip} ${a.filename} ${a.link ?? ""}`.toLowerCase().includes(q))
    );
  }, [apps, filterProfile, filterText]);

  function pickImportFiles(files: FileList | null) {
    setImportMsg(null);
    const profileName = allProfiles.find((p) => p.id === importProfile)?.name ?? "";
    const items = Array.from(files ?? [])
      .map((f) => parseResumeFile(f, profileName))
      .filter((x): x is ImportItem => x !== null)
      .sort((a, b) => (a.time < b.time ? -1 : 1));
    setImportItems(items);
    if (files?.length && items.length === 0) setImportMsg("No resume PDFs found in the selected files.");
  }

  async function runImport() {
    if (!importProfile || importItems.length === 0) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/applications", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-key": key },
        body: JSON.stringify({ profile: importProfile, items: importItems }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Import failed (${res.status})`);
      setImportMsg(
        `Added ${data.added}` + (data.skipped ? `, skipped ${data.skipped} already in the history.` : ".")
      );
      setImportItems([]);
      await load(key);
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function exportCsv() {
    const names = Object.fromEntries(allProfiles.map((p) => [p.id, p.name]));
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = [
      ["Date", "Time", "Profile", "Company", "Role", "IP", "File", "Job link"],
      ...filtered.map((a) => {
        const d = new Date(a.time);
        return [dayKey(d), d.toLocaleTimeString(), names[a.profile] ?? a.profile, a.company, a.role, a.ip, a.filename, a.link ?? ""];
      }),
    ];
    const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `applications-${dayKey(new Date())}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---- login ----
  if (!key || !apps) {
    return (
      <main style={{ padding: "4rem 1rem", maxWidth: "24rem", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Admin</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.25rem" }}>Job applications per profile.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(keyInput.trim());
          }}
          style={{ display: "grid", gap: "0.75rem" }}
        >
          <input
            type="password"
            placeholder="Admin password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoFocus
            style={input}
          />
          <button type="submit" disabled={loading || !keyInput.trim()} style={button}>
            {loading ? "Checking…" : "Open"}
          </button>
          {error && <p style={{ color: "#f87171" }}>{error}</p>}
        </form>
      </main>
    );
  }

  const { per, all, days, weeks, blank } = stats;
  const row = (id: string) => per[id] ?? blank();
  const names = Object.fromEntries(allProfiles.map((p) => [p.id, p.name]));

  return (
    <main style={{ padding: "2rem 1rem", maxWidth: "72rem", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", flex: 1 }}>Applications</h1>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          {loading ? "Refreshing…" : "Auto-refreshes every minute"}
        </span>
        <button style={ghost} onClick={() => load(key)}>Refresh</button>
        <button
          style={ghost}
          onClick={() => {
            writeKey(null);
            setKey("");
            setApps(null);
            setKeyInput("");
          }}
        >
          Log out
        </button>
      </div>
      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      {/* Today / this week tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
        {[
          ["Today", all.today],
          ["Yesterday", all.yesterday],
          ["This week", all.week],
          ["Last week", all.lastWeek],
          ["All time", all.total],
        ].map(([label, value]) => (
          <div key={label as string} style={{ ...card, marginBottom: 0, padding: "1rem" }}>
            <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{label}</div>
            <div style={{ fontSize: "1.9rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Bar chart: daily / weekly / monthly, stacked by profile (all admins) */}
      <section style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1.1rem", flex: 1 }}>
            Applications per {chartMode === "day" ? "day" : chartMode === "week" ? "week" : "month"}
            <span style={{ color: "var(--muted)", fontSize: "0.85rem", fontWeight: 400, marginLeft: "0.5rem" }}>
              {chartMode === "day" ? `last ${DAYS_SHOWN} days` : chartMode === "week" ? `last ${WEEKS_SHOWN} weeks (Mon–Sun)` : `last ${MONTHS_SHOWN} months`}
            </span>
          </h2>
          <div role="tablist" style={{ display: "inline-flex", border: "1px solid #3a3a44", borderRadius: 8, overflow: "hidden" }}>
            {([["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]] as const).map(([m, label]) => (
              <button
                key={m}
                role="tab"
                aria-selected={chartMode === m}
                onClick={() => setChartMode(m)}
                style={{
                  padding: "0.35rem 0.85rem",
                  fontSize: "0.85rem",
                  border: "none",
                  cursor: "pointer",
                  background: chartMode === m ? "#3a3a44" : "transparent",
                  color: chartMode === m ? "var(--text)" : "var(--muted)",
                  fontWeight: chartMode === m ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* legend: click a profile to hide / show it in the chart */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 0.5rem", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
          {chart.series.map((s) => {
            const off = hiddenSeries.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={!off}
                title={off ? `Show ${s.name}` : `Hide ${s.name}`}
                onClick={() => toggleSeries(s.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0.2rem 0.45rem",
                  border: "none",
                  borderRadius: 6,
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "inherit",
                  color: off ? "#5c5c66" : "var(--muted)",
                  textDecoration: off ? "line-through" : "none",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    boxSizing: "border-box",
                    background: off ? "transparent" : s.color,
                    border: `2px solid ${s.color}`,
                    opacity: off ? 0.6 : 1,
                  }}
                />
                {s.name}
              </button>
            );
          })}
          {hiddenSeries.size > 0 && (
            <button
              type="button"
              onClick={() => setHiddenSeries(new Set())}
              style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "inherit", textDecoration: "underline" }}
            >
              Show all
            </button>
          )}
        </div>
        <BarChart periods={chart.periods} series={chart.series.filter((s) => !hiddenSeries.has(s.id))} />
      </section>

      {/* Everything below is super admin only; general admins see the tiles, per-profile table and chart. */}
      {role === "super" && <>
      {/* Daily */}
      <section style={card}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Every day (last {DAYS_SHOWN} days)</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Day</th>
                {allProfiles.map((p) => (
                  <th key={p.id} style={{ ...th, textAlign: "right" }}>{p.name}</th>
                ))}
                <th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => {
                const k = dayKey(d);
                return (
                  <tr key={k}>
                    <td style={td}>{i === 0 ? "Today" : i === 1 ? "Yesterday" : fmtDay(d)}</td>
                    {allProfiles.map((p) => {
                      const v = row(p.id).byDay[k] ?? 0;
                      return <td key={p.id} style={{ ...num, color: v ? "var(--text)" : "var(--muted)" }}>{v}</td>;
                    })}
                    <td style={{ ...num, fontWeight: 700 }}>{all.byDay[k] ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Weekly */}
      <section style={card}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Every week (Mon–Sun, last {WEEKS_SHOWN} weeks)</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Week</th>
                {allProfiles.map((p) => (
                  <th key={p.id} style={{ ...th, textAlign: "right" }}>{p.name}</th>
                ))}
                <th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => {
                const k = dayKey(w);
                return (
                  <tr key={k}>
                    <td style={td}>
                      {i === 0 ? "This week" : i === 1 ? "Last week" : ""}
                      <span style={{ color: "var(--muted)", marginLeft: i < 2 ? "0.5rem" : 0 }}>
                        {fmtShort(w)} – {fmtShort(addDays(w, 6))}
                      </span>
                    </td>
                    {allProfiles.map((p) => {
                      const v = row(p.id).byWeek[k] ?? 0;
                      return <td key={p.id} style={{ ...num, color: v ? "var(--text)" : "var(--muted)" }}>{v}</td>;
                    })}
                    <td style={{ ...num, fontWeight: 700 }}>{all.byWeek[k] ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Profiles: add from PDF, edit resume, login, archive */}
      {role === "super" && <ProfilesPanel adminKey={key} profiles={profiles} reload={() => load(key)} />}

      {/* Import past resumes (super admin only) */}
      {role === "super" && <section style={card}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.25rem" }}>Import past resumes</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          For resumes made before counting started. Choose the profile, then select the resume PDF files
          (e.g. from Downloads). Company and role come from the file name, the time from the file&apos;s
          date. Files already in the history are skipped.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={importProfile}
            onChange={(e) => {
              setImportProfile(e.target.value);
              setImportItems([]);
              setImportMsg(null);
            }}
            style={input}
          >
            <option value="">Choose profile…</option>
            {allProfiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            key={importProfile}
            type="file"
            multiple
            accept=".pdf,application/pdf"
            disabled={!importProfile}
            onChange={(e) => pickImportFiles(e.target.files)}
            style={{ ...input, padding: "0.35rem" }}
          />
          <button
            style={button}
            disabled={!importProfile || importItems.length === 0 || importing}
            onClick={runImport}
          >
            {importing ? "Importing…" : `Import ${importItems.length || ""}`.trim()}
          </button>
        </div>
        {importMsg && <p style={{ marginTop: "0.75rem" }}>{importMsg}</p>}
        {importItems.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>Company</th>
                  <th style={th}>Role</th>
                </tr>
              </thead>
              <tbody>
                {importItems.map((it, i) => (
                  <tr key={i}>
                    <td style={td}>{fmtTime(it.time)}</td>
                    <td style={td}>{it.company}</td>
                    <td style={{ ...td, whiteSpace: "normal" }}>{it.role || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {/* All applications */}
      <section style={card}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1.1rem", flex: 1 }}>Applications ({filtered.length})</h2>
          <select value={filterProfile} onChange={(e) => setFilterProfile(e.target.value)} style={input}>
            <option value="">All profiles</option>
            {allProfiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            placeholder="Search company, role, IP…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={input}
          />
          <button style={ghost} onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</button>
        </div>
        {filtered.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            No applications yet. Each resume generated on a profile page is counted here.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>Profile</th>
                  <th style={th}>Company</th>
                  <th style={th}>Role</th>
                  <th style={th}>Job link</th>
                  <th style={th}>IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, listLimit).map((a) => (
                  <tr key={a.id}>
                    <td style={td}>{fmtTime(a.time)}</td>
                    <td style={td}>{names[a.profile] ?? a.profile}</td>
                    <td style={{ ...td, whiteSpace: "normal" }}>{a.company || "—"}</td>
                    <td style={{ ...td, whiteSpace: "normal" }}>{a.role || "—"}</td>
                    <td style={td}>
                      {safeLink(a.link) ? (
                        <a href={safeLink(a.link)} target="_blank" rel="noopener noreferrer" title={a.link}>
                          Open ↗
                        </a>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, color: "var(--muted)" }}>{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > listLimit && (
              <button style={{ ...ghost, marginTop: "0.75rem" }} onClick={() => setListLimit((n) => n + 100)}>
                Show more ({filtered.length - listLimit} left)
              </button>
            )}
          </div>
        )}
      </section>
      </>}
    </main>
  );
}
