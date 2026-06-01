"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = "#8b98a9";
const GRID = "#1b2738";
const PRIMARY = "#58a6ff";
const ACCENT = "#3fb950";
const AMBER = "#fbbf24";

const TOOLTIP_STYLE = {
  background: "rgba(14,22,35,0.95)",
  border: "1px solid #1f2a3a",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 10px 30px -12px rgba(0,0,0,0.6)",
} as const;

// ── Score radar ──────────────────────────────────────────────────────────────
export function ScoreRadarChart({
  data,
  color = PRIMARY,
  height = 220,
}: {
  data: { axis: string; value: number }[];
  color?: string;
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="68%">
        <defs>
          <radialGradient id={`radar-${id}`}>
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0.12} />
          </radialGradient>
        </defs>
        <PolarGrid stroke={GRID} />
        <PolarAngleAxis dataKey="axis" tick={{ fill: AXIS, fontSize: 10.5 }} />
        <Radar
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#radar-${id})`}
          dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
          isAnimationActive
          animationDuration={650}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: GRID }}
          formatter={(v) => [`${Math.round(Number(v) * 100)}`, "score"]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ── Star / fork history ──────────────────────────────────────────────────────
export function StarTrendChart({
  data,
  height = 220,
}: {
  data: { date: string; stars: number; forks: number }[];
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));
  const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id={`stars-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMBER} stopOpacity={0.4} />
            <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`forks-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.25} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10.5 }} stroke={GRID} tickLine={false} minTickGap={24} />
        <YAxis tick={{ fill: AXIS, fontSize: 10.5 }} stroke={GRID} tickLine={false} width={36} tickFormatter={fmtK} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: GRID }} />
        <Area
          type="monotone"
          dataKey="stars"
          stroke={AMBER}
          strokeWidth={2}
          fill={`url(#stars-${id})`}
          dot={false}
          activeDot={{ r: 3.5 }}
          isAnimationActive
          animationDuration={650}
        />
        <Area
          type="monotone"
          dataKey="forks"
          stroke={ACCENT}
          strokeWidth={1.5}
          fill={`url(#forks-${id})`}
          dot={false}
          isAnimationActive
          animationDuration={650}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────
// Lightweight inline-SVG sparkline for dense lists (no ResponsiveContainer cost).
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = PRIMARY,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, height - 2 - ((v - min) / range) * (height - 4)]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2} fill={color} />
    </svg>
  );
}

// ── RingGauge ────────────────────────────────────────────────────────────────
// Compact circular score indicator (pure SVG).
export function RingGauge({
  value,
  size = 56,
  stroke = 5,
  color,
  label,
}: {
  value: number | null | undefined;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  const col = color ?? (v >= 0.75 ? ACCENT : v >= 0.5 ? PRIMARY : v >= 0.3 ? AMBER : "#fb7185");
  return (
    <div className="inline-flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)" }}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="#e8eef6"
          style={{ fontSize: size * 0.3, fontWeight: 600 }}
        >
          {Math.round(v * 100)}
        </text>
      </svg>
      {label && (
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      )}
    </div>
  );
}
