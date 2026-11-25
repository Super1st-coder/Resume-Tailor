"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Stacked bar chart: one bar per period, one segment per profile.
 * Plain SVG, no library. Colors: validated categorical palette (dark steps,
 * checked against the admin surface #1a1a20). Color follows the profile, in a
 * fixed order; profiles past the 8th fold into "Other".
 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"];
const OTHER_COLOR = "#8a8a94";

export type Series = { id: string; name: string; color: string };
export type Period = { key: string; label: string; tip: string; counts: Record<string, number> };

/** Give each profile its fixed color; the 9th and later become one "Other" series. */
export function buildSeries(profiles: { id: string; name: string }[]): {
  series: Series[];
  seriesOf: (profileId: string) => string;
} {
  const shown = profiles.slice(0, SERIES_COLORS.length);
  const series: Series[] = shown.map((p, i) => ({ id: p.id, name: p.name, color: SERIES_COLORS[i] }));
  const ids = new Set(shown.map((p) => p.id));
  if (profiles.length > shown.length) series.push({ id: "__other", name: "Other", color: OTHER_COLOR });
  return { series, seriesOf: (id) => (ids.has(id) ? id : "__other") };
}

const H = 240; // plot height
const PAD = { top: 22, right: 8, bottom: 34, left: 34 };
const GAP = 2; // surface gap between stacked segments
const RADIUS = 4;

function niceMax(v: number): { max: number; step: number } {
  if (v <= 0) return { max: 4, step: 1 };
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const s = Math.max(1, Math.ceil(step));
  return { max: Math.ceil(v / s) * s, step: s };
}

/** Rect with only the top corners rounded (data end), square at the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export default function BarChart({ periods, series }: { periods: Period[]; series: Series[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = periods.map((p) => series.reduce((s, se) => s + (p.counts[se.id] ?? 0), 0));
  const { max, step } = niceMax(Math.max(0, ...totals));
  const plotW = width - PAD.left - PAD.right;
  const band = plotW / Math.max(1, periods.length);
  const barW = Math.min(24, Math.max(6, band * 0.6));
  const y = (v: number) => PAD.top + H - (v / max) * H;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  // Thin out x labels when bars are narrow.
  const labelEvery = Math.ceil(56 / band);

  const hp = hover !== null ? periods[hover] : null;
  const tipLeft = hover !== null ? PAD.left + band * hover + band / 2 : 0;

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%" }} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={H + PAD.top + PAD.bottom} role="img" aria-label="Applications per period, stacked by profile" style={{ display: "block" }}>
        {/* recessive grid + y axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#2c2c34" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
              {t}
            </text>
          </g>
        ))}
        {periods.map((p, i) => {
          const cx = PAD.left + band * i + band / 2;
          const x = cx - barW / 2;
          let acc = 0;
          const segs = series
            .map((se) => ({ se, v: p.counts[se.id] ?? 0 }))
            .filter((s) => s.v > 0);
          const total = totals[i];
          const dim = hover !== null && hover !== i;
          return (
            <g key={p.key} opacity={dim ? 0.45 : 1}>
              {segs.map(({ se, v }, j) => {
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const isTop = j === segs.length - 1;
                // 2px surface gap above every segment except the top one
                const h = Math.max(1, y0 - y1 - (isTop ? 0 : GAP));
                const top = isTop ? y1 : y1 + GAP;
                return isTop ? (
                  <path key={se.id} d={topRounded(x, top, barW, h, RADIUS)} fill={se.color} />
                ) : (
                  <rect key={se.id} x={x} y={top} width={barW} height={h} fill={se.color} />
                );
              })}
              {total > 0 && (
                <text x={cx} y={y(total) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">
                  {total}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={PAD.top + H + 18} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {p.label}
                </text>
              )}
              {/* hit target: the whole band, taller than the mark */}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
              />
            </g>
          );
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="#4a4a55" strokeWidth={1} />
      </svg>

      {hp && hover !== null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            // beside the bar, never over it: right of the bar, or left when there's no room
            left: tipLeft + barW / 2 + 12 + 180 <= width ? tipLeft + barW / 2 + 12 : Math.max(0, tipLeft - barW / 2 - 12 - 180),
            width: 180,
            pointerEvents: "none",
            background: "#24242c",
            border: "1px solid #3a3a44",
            borderRadius: 8,
            padding: "0.5rem 0.65rem",
            fontSize: "0.8rem",
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hp.tip}</div>
          {series.map((se) => (
            <div key={se.id} style={{ display: "flex", alignItems: "center", gap: 6, lineHeight: 1.6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: se.color, flex: "none" }} />
              <span style={{ flex: 1, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {se.name}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{hp.counts[se.id] ?? 0}</span>
            </div>
          ))}
          <div style={{ display: "flex", borderTop: "1px solid #3a3a44", marginTop: 4, paddingTop: 4, fontWeight: 600 }}>
            <span style={{ flex: 1 }}>Total</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{totals[hover]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
