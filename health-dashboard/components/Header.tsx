"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboardStore } from "@/lib/store";
import { Activity, Heart, Moon, Thermometer, Settings as SettingsIcon, Database, RefreshCw, ChartSpline } from "lucide-react";
import { MetricInfo } from "@/components/MetricInfo";

const LIVE_REFRESH_MS = 15000;

interface HeaderProps {
  onOpenSettings: () => void;
}

export function Header({ onOpenSettings }: HeaderProps) {
  const pathname = usePathname();
  const { dataMode, setDataMode, lastSync, liveData, setLiveData, setLastSync, addToast } = useDashboardStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const refreshLiveData = useCallback(async (silent = false) => {
    if (dataMode !== "live" || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const liveRes = await fetch("/api/live-data");
      if (liveRes.ok) {
        const livePayload = await liveRes.json();
        setLiveData(livePayload);
        setLastSync(new Date().toISOString());
      } else if (!silent) {
        addToast("Live data fetch failed.", "error");
      }
    } catch {
      if (!silent) addToast("Backend is offline.", "error");
    } finally {
      setIsRefreshing(false);
    }
  }, [addToast, dataMode, isRefreshing, setLastSync, setLiveData]);

  const handleRefresh = () => refreshLiveData(false);

  useEffect(() => {
    if (dataMode !== "live") return;
    refreshLiveData(true);
    const id = window.setInterval(() => refreshLiveData(true), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [dataMode, refreshLiveData]);

  const handleToggleMode = async () => {
    if (dataMode === "live") {
      setDataMode("sample");
      addToast("Switched to Sample Data Mode.", "info");
    } else {
      setIsToggling(true);
      try {
        const statusRes = await fetch("/api/status");
        if (!statusRes.ok) throw new Error("Backend offline");
        const statusData = await statusRes.json();
        
        if (statusData.token_valid) {
          const liveRes = await fetch("/api/live-data");
          if (!liveRes.ok) throw new Error("Failed to fetch live data");
          const livePayload = await liveRes.json();
          
          setLiveData(livePayload);
          setLastSync(new Date().toISOString());
          setDataMode("live");
          addToast("Connected — Live Data Mode active! Successfully synced physiological measurements.", "success");
        } else {
          addToast("No valid Google OAuth token found. Open Settings, then Connect Google.", "error");
        }
      } catch {
        addToast("Cannot connect to Google Health gateway.", "error");
      } finally {
        setIsToggling(false);
      }
    }
  };

  // Navigation tabs definition
  const navigation = [
    { name: "Overview", href: "/", icon: Activity },
    { name: "Heart", href: "/heart", icon: ChartSpline },
    { name: "Recovery", href: "/recovery", icon: Heart },
    { name: "Sleep", href: "/sleep", icon: Moon },
    { name: "Raw Metrics", href: "/raw", icon: Database },
  ];

  // Helper to determine stream quality
  const getQualityColor = (streamName: string) => {
    if (dataMode === "sample") return "bg-emerald-500 shadow-emerald-500/20";
    if (!liveData) return "bg-red-500 shadow-red-500/20";

    let hasData = false;
    switch (streamName) {
      case "Heart Rate":
        hasData = (liveData.heart_rate || []).length > 0;
        break;
      case "HRV":
        hasData = (liveData.hrv || []).length > 0;
        break;
      case "SpO2":
        hasData = (liveData.spo2 || []).length > 0;
        break;
      case "Skin Temp":
        hasData = (liveData.sleep_temp || []).length > 0;
        break;
      default:
        break;
    }

    return hasData ? "bg-emerald-500 shadow-emerald-500/20" : "bg-amber-500 shadow-amber-500/20";
  };

  const getLatestValue = (streamName: string): string => {
    if (dataMode === "sample") {
      // Representative sample values
      switch (streamName) {
        case "Heart Rate": return "72 bpm";
        case "HRV": return "51 ms";
        case "SpO2": return "97.4%";
        case "Skin Temp": return "+0.12°C";
      }
    }
    if (!liveData) return "—";
    switch (streamName) {
      case "Heart Rate": {
        const arr = liveData.heart_rate || [];
        if (!arr.length) return "—";
        return `${Math.round(arr[arr.length - 1].value)} bpm`;
      }
      case "HRV": {
        const arr = liveData.hrv || [];
        if (!arr.length) return "—";
        return `${Math.round(arr[arr.length - 1].value)} ms`;
      }
      case "SpO2": {
        const arr = liveData.spo2 || [];
        const darr = liveData.daily_spo2 || [];
        const src = arr.length ? arr : darr;
        if (!src.length) return "—";
        return `${src[src.length - 1].value.toFixed(1)}%`;
      }
      case "Skin Temp": {
        const arr = liveData.sleep_temp || [];
        if (!arr.length) return "—";
        const v = arr[arr.length - 1].value;
        // If value > 10, API is returning absolute body temp (not deviation)
        if (Math.abs(v) > 10) return `${v.toFixed(1)}°C`;
        return `${v >= 0 ? "+" : ""}${v.toFixed(2)}°C`;
      }
      default: return "—";
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-slate-950/70 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3 sm:flex-nowrap sm:py-0">
          {/* Logo */}
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-violet-600 to-indigo-500 shadow-lg shadow-indigo-500/25">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <span className="whitespace-nowrap bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-base font-bold tracking-tight text-transparent sm:text-lg">
              Fitbit Air
            </span>
            <span className="hidden rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400 sm:inline-block">
              API v4 Gateway
            </span>
          </div>

          {/* Navigation Tabs */}
          <nav className="order-3 flex w-full items-center justify-between gap-1 sm:order-none sm:w-auto sm:justify-center sm:gap-2">
            {navigation.map((tab) => {
              const Icon = tab.icon;
              const isActive = pathname === tab.href;
              return (
                <Link
                  key={tab.name}
                  href={tab.href}
                  className={`flex h-10 w-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-all duration-200 sm:h-auto sm:w-auto sm:px-3 sm:py-2 ${
                    isActive
                      ? "bg-white/10 text-white shadow-sm"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.name}</span>
                </Link>
              );
            })}

            <button
              onClick={onOpenSettings}
              className="flex h-10 w-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-slate-400 transition-all duration-200 hover:bg-white/5 hover:text-slate-200 sm:h-auto sm:w-auto sm:px-3 sm:py-2"
            >
              <SettingsIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </nav>

          {/* Status Badge & Sync Info */}
          <div className="order-2 flex shrink-0 items-center gap-2 sm:order-none sm:gap-3">
            {/* Sync timestamp */}
            <div className="hidden text-right text-xs md:block">
              <span className="text-slate-500">Last Sync:</span>{" "}
              <span className="font-mono text-slate-300">
                {lastSync ? new Date(lastSync).toLocaleTimeString() : "—"}
              </span>
            </div>

            {/* Refresh Button */}
            {dataMode === "live" && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors disabled:opacity-50"
                title="Refresh Data"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`} />
              </button>
            )}

            {/* Connection / Toggle Switch */}
            <button
              onClick={handleToggleMode}
              disabled={isToggling}
              className={`relative inline-flex h-8 w-28 items-center rounded-full border px-1 text-[10px] font-bold tracking-wide transition-all duration-300 sm:w-32 ${
                dataMode === "live"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_12px_-3px_rgba(16,185,129,0.25)] hover:bg-emerald-500/20 cursor-pointer"
                  : "bg-slate-800/80 border-slate-700 hover:bg-slate-700/80 text-slate-400 cursor-pointer"
              } disabled:opacity-50`}
              title="Click to toggle between Mock and Live Google Health API data"
            >
              <span
                className={`absolute h-6 w-6 rounded-full transition-all duration-300 flex items-center justify-center ${
                  dataMode === "live"
                    ? "right-1 bg-emerald-500 shadow-md shadow-emerald-500/50"
                    : "left-1 bg-slate-600"
                } ${isToggling ? "animate-pulse" : ""}`}
              />
              <span className={`hidden w-full text-center transition-opacity duration-300 sm:block ${
                dataMode === "live" ? "pr-6 text-emerald-300" : "pl-6 text-slate-300"
              }`}>
                {isToggling ? "SYNC..." : dataMode === "live" ? "LIVE DATA" : "SAMPLE DATA"}
              </span>
              <span className={`block w-full text-center transition-opacity duration-300 sm:hidden ${
                dataMode === "live" ? "pr-6 text-emerald-300" : "pl-6 text-slate-300"
              }`}>
                {isToggling ? "SYNC" : dataMode === "live" ? "LIVE" : "SAMPLE"}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Data Quality Indicator Row */}
      <div className="border-t border-white/5 bg-slate-950/40 py-2">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-y-2 text-xs">
            <span className="text-slate-500 font-medium">Physiological Data Streams:</span>
            <div className="flex flex-wrap gap-4 sm:gap-6">
              {[
                { name: "Heart Rate", icon: Heart, key: "heart_rate" },
                { name: "HRV", icon: Activity, key: "hrv" },
                { name: "SpO2", icon: Moon, key: "spo2" },
                { name: "Skin Temp", icon: Thermometer, key: "skin_temp" },
              ].map((stream) => {
                const StreamIcon = stream.icon;
                const dotColor = getQualityColor(stream.name);
                return (
                  <div key={stream.name} className="flex items-center gap-2 text-slate-300 font-mono">
                    <span className={`h-2 w-2 rounded-full shadow-md ${dotColor}`} />
                    <StreamIcon className="h-3.5 w-3.5 text-slate-500" />
                    <div className="flex items-center gap-1">
                      <span>{stream.name}</span>
                      <MetricInfo metricKey={stream.key} size="sm" />
                    </div>
                    <span
                      className={`font-bold tabular-nums ${
                        dataMode === "live" ? "text-emerald-400" : "text-slate-300"
                      }`}
                    >
                      {getLatestValue(stream.name)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
export default Header;
