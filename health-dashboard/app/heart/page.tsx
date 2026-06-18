"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, HeartPulse, ShieldCheck, Timer, Waves } from "lucide-react";
import { useDashboardStore } from "@/lib/store";

type HRPoint = {
  timestamp: string;
  value: number;
};

type Zone = {
  key: string;
  label: string;
  min: number;
  max: number;
  color: string;
  fill: string;
};

const RANGE_OPTIONS = [
  { label: "15m", ms: 15 * 60 * 1000 },
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "3h", ms: 3 * 60 * 60 * 1000 },
  { label: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "All", ms: Infinity },
];

const zoneColors: Record<string, { color: string; fill: string; label: string }> = {
  LIGHT: { color: "#38bdf8", fill: "rgba(56,189,248,0.10)", label: "Light" },
  MODERATE: { color: "#22c55e", fill: "rgba(34,197,94,0.10)", label: "Moderate" },
  VIGOROUS: { color: "#f59e0b", fill: "rgba(245,158,11,0.10)", label: "Vigorous" },
  PEAK: { color: "#ef4444", fill: "rgba(239,68,68,0.10)", label: "Peak" },
};

function fmtTime(timestamp: string | number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtAge(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildZones(liveData: any, maxHR: number, restingHR: number): Zone[] {
  const latest = [...(liveData?.daily_heart_rate_zones || [])].pop();
  if (latest?.zones?.length) {
    return latest.zones
      .filter((zone: any) => zone.type && zone.min && zone.max)
      .map((zone: any) => ({
        key: zone.type,
        label: zoneColors[zone.type]?.label || zone.type,
        min: zone.min,
        max: zone.max,
        color: zoneColors[zone.type]?.color || "#94a3b8",
        fill: zoneColors[zone.type]?.fill || "rgba(148,163,184,0.08)",
      }));
  }

  const reserve = Math.max(1, maxHR - restingHR);
  return [
    { key: "LIGHT", min: Math.round(restingHR + reserve * 0.3), max: Math.round(restingHR + reserve * 0.5), ...zoneColors.LIGHT },
    { key: "MODERATE", min: Math.round(restingHR + reserve * 0.5), max: Math.round(restingHR + reserve * 0.7), ...zoneColors.MODERATE },
    { key: "VIGOROUS", min: Math.round(restingHR + reserve * 0.7), max: Math.round(restingHR + reserve * 0.85), ...zoneColors.VIGOROUS },
    { key: "PEAK", min: Math.round(restingHR + reserve * 0.85), max: maxHR, ...zoneColors.PEAK },
  ];
}

function zoneForBpm(bpm: number, zones: Zone[]) {
  return [...zones].reverse().find((zone) => bpm >= zone.min) || null;
}

function useSecondTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  sub: string;
}) {
  return (
    <div className="glow-card rounded-2xl border border-white/10 bg-slate-900/50 p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-black text-white">{value}</span>
            {unit && <span className="text-xs font-semibold text-slate-400">{unit}</span>}
          </div>
          <p className="mt-2 text-xs text-slate-400">{sub}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-300">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function HeartPage() {
  const { dataMode, liveData, lastSync, settings } = useDashboardStore();
  const [rangeMs, setRangeMs] = useState<number>(3 * 60 * 60 * 1000);
  const now = useSecondTick();

  const heartRate = useMemo(() => {
    const live = dataMode === "live" ? (liveData?.heart_rate || []) : [];
    if (live.length) return live as HRPoint[];

    const start = now - 3 * 60 * 60 * 1000;
    return Array.from({ length: 180 }, (_, index) => {
      const t = start + index * 60 * 1000;
      return {
        timestamp: new Date(t).toISOString(),
        value: 66 + Math.sin(index / 8) * 5 + Math.sin(index / 21) * 10,
      };
    });
  }, [dataMode, liveData, now]);

  const chartData = useMemo(() => {
    const sorted = [...heartRate]
      .filter((point) => point.timestamp && Number.isFinite(Number(point.value)))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const latest = sorted[sorted.length - 1];
    const cutoff = latest && Number.isFinite(rangeMs) ? Date.parse(latest.timestamp) - rangeMs : 0;
    return sorted
      .filter((point) => !Number.isFinite(rangeMs) || Date.parse(point.timestamp) >= cutoff)
      .map((point) => ({
        ...point,
        bpm: Math.round(Number(point.value)),
        t: Date.parse(point.timestamp),
        time: fmtTime(point.timestamp),
      }));
  }, [heartRate, rangeMs]);

  const zones = useMemo(
    () => buildZones(liveData, settings.maxHR, settings.restingHR),
    [liveData, settings.maxHR, settings.restingHR]
  );

  const values = chartData.map((point) => point.bpm);
  const latest = chartData[chartData.length - 1];
  const latestZone = latest ? zoneForBpm(latest.bpm, zones) : null;
  const minBpm = values.length ? Math.min(...values) : 0;
  const maxBpm = values.length ? Math.max(...values) : 0;
  const avgBpm = Math.round(avg(values));
  const yMin = Math.max(35, Math.floor(minBpm / 10) * 10 - 10);
  const yMax = Math.min(220, Math.ceil(maxBpm / 10) * 10 + 10);

  const zoneMinutes = useMemo(() => {
    const computed: Record<string, number> = Object.fromEntries(zones.map((zone) => [zone.key, 0]));
    const native = liveData?.time_in_heart_rate_zone || [];
    if (native.length) {
      native.forEach((record: any) => {
        if (record.zone && Number.isFinite(Number(record.minutes))) {
          computed[record.zone] = (computed[record.zone] || 0) + Number(record.minutes);
        }
      });
      return computed;
    }

    for (let i = 0; i < chartData.length - 1; i += 1) {
      const current = chartData[i];
      const next = chartData[i + 1];
      const zone = zoneForBpm(current.bpm, zones);
      if (!zone) continue;
      const seconds = Math.min(90, Math.max(0, (next.t - current.t) / 1000));
      computed[zone.key] += seconds / 60;
    }
    return computed;
  }, [chartData, liveData, zones]);

  const allSupported = [
    ["Heart rate", liveData?.heart_rate?.length],
    ["Phone HR", liveData?.mobile_heart_rate?.length],
    ["Resting HR", liveData?.daily_resting_hr?.length],
    ["Heart zones", liveData?.daily_heart_rate_zones?.length],
    ["Zone time", liveData?.time_in_heart_rate_zone?.length],
    ["SpO2", liveData?.spo2?.length || liveData?.daily_spo2?.length],
    ["HRV", liveData?.raw_hrv?.length || liveData?.hrv?.length],
    ["VO2 max", liveData?.daily_vo2_max?.length || liveData?.derived?.vo2_max?.length],
    ["Sleep", liveData?.sleep?.length],
    ["Skin temp", liveData?.sleep_temp?.length],
    ["Steps", liveData?.steps?.length],
  ];

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col gap-4 border-b border-white/5 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Cardiac Command Center</h1>
          <p className="mt-1 text-sm text-slate-400">BPM stream, zone load, resting baseline, and cardio fitness.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 font-semibold text-emerald-300">
            Webhook + refresh 15s
          </span>
          <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono">
            Sync {lastSync ? new Date(lastSync).toLocaleTimeString() : "--"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={HeartPulse}
          label="Current BPM"
          value={latest?.bpm ?? "--"}
          unit="bpm"
          sub={latest ? `${latestZone?.label || "Below zone"} - ${fmtAge(now - latest.t)} old` : "No heart data"}
        />
        <StatCard icon={Activity} label="Average" value={avgBpm || "--"} unit="bpm" sub="Visible window mean" />
        <StatCard icon={Waves} label="Range" value={values.length ? `${minBpm}-${maxBpm}` : "--"} unit="bpm" sub="Min and max in view" />
        <StatCard
          icon={ShieldCheck}
          label="Resting HR"
          value={Math.round(liveData?.daily_resting_hr?.at?.(-1)?.value || settings.restingHR)}
          unit="bpm"
          sub={liveData?.daily_resting_hr?.length ? "Google daily baseline" : "Settings fallback"}
        />
      </div>

      <section className="glow-card rounded-2xl border border-white/10 bg-slate-900/50 p-4 shadow-xl sm:p-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Live BPM Explorer</h2>
            <p className="text-xs text-slate-400">{chartData.length.toLocaleString()} samples in selected window</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.label}
                onClick={() => setRangeMs(option.ms)}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                  rangeMs === option.ms
                    ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
                    : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[440px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 18, left: -18, bottom: 8 }}>
              <defs>
                <linearGradient id="bpmFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fb7185" stopOpacity={0.42} />
                  <stop offset="70%" stopColor="#fb7185" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
              {zones.map((zone) => (
                <ReferenceArea key={zone.key} y1={zone.min} y2={zone.max} fill={zone.fill} stroke="transparent" />
              ))}
              <ReferenceLine y={settings.restingHR} stroke="rgba(148,163,184,0.55)" strokeDasharray="4 4" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={fmtTime}
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[yMin, yMax]}
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderColor: "rgba(255,255,255,0.12)",
                  borderRadius: "8px",
                }}
                labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
                formatter={(value: any) => [`${value} bpm`, "Heart rate"]}
              />
              <Area
                type="monotone"
                dataKey="bpm"
                stroke="#fb7185"
                strokeWidth={2.5}
                fill="url(#bpmFill)"
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              <Brush dataKey="time" height={28} travellerWidth={10} stroke="#fb7185" fill="#111827" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="glow-card rounded-2xl border border-white/10 bg-slate-900/50 p-5 shadow-xl">
          <div className="mb-4 flex items-center gap-2">
            <Timer className="h-5 w-5 text-rose-300" />
            <h2 className="text-base font-bold text-white">Zone Load</h2>
          </div>
          <div className="space-y-4">
            {zones.map((zone) => {
              const minutes = zoneMinutes[zone.key] || 0;
              const maxMinutes = Math.max(...Object.values(zoneMinutes), 1);
              return (
                <div key={zone.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">{zone.label}</span>
                    <span className="font-mono text-slate-400">
                      {Math.round(minutes)}m - {zone.min}-{zone.max} bpm
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, (minutes / maxMinutes) * 100)}%`, backgroundColor: zone.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="glow-card rounded-2xl border border-white/10 bg-slate-900/50 p-5 shadow-xl">
          <h2 className="mb-4 text-base font-bold text-white">Fitbit/Google Coverage</h2>
          <div className="grid grid-cols-2 gap-2">
            {allSupported.map(([label, count]) => {
              const hasData = Number(count || 0) > 0;
              return (
                <div key={String(label)} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${hasData ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <span className="text-xs font-semibold text-slate-200">{label}</span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-slate-500">{Number(count || 0).toLocaleString()} records</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="glow-card rounded-2xl border border-white/10 bg-slate-900/50 p-5 shadow-xl">
        <h2 className="mb-4 text-base font-bold text-white">Latest BPM Samples</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[...chartData].slice(-8).reverse().map((point) => (
            <div key={`${point.timestamp}-${point.bpm}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-lg font-black text-white">{point.bpm}</span>
                <span className="text-xs text-slate-500">{fmtTime(point.t)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{zoneForBpm(point.bpm, zones)?.label || "Below zone"}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
