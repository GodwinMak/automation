// utils/formatters.ts

import { T } from "./Constants";

export function ifaceCapacity(iface?: string, portSpeed?: number | string): number {
  if (portSpeed !== undefined && portSpeed !== null) {
    const ps = parseInt(String(portSpeed), 10);
    if (!isNaN(ps) && ps > 0) {
      if (ps === 100000) return 100;
      if (ps === 40000) return 40;
      if (ps === 10000) return 10;
      if (ps === 1000) return 1;
      return ps / 1000;
    }
  }
  return 1;
}

export function ifaceLabel(iface?: string, portSpeed?: number | string): string {
  if (portSpeed !== undefined && portSpeed !== null) {
    const ps = parseInt(String(portSpeed), 10);
    if (!isNaN(ps) && ps > 0) {
      if (ps === 100000) return "100G";
      if (ps === 40000) return "40G";
      if (ps === 10000) return "10G";
      if (ps === 1000) return "1G";
      return ps + "M";
    }
  }
  return "1G";
}

export function trafficUtil(
  input_bps?: number | string,
  output_bps?: number | string,
  portSpeed?: number | string
): number | null {
  if (!portSpeed || parseInt(String(portSpeed), 10) <= 0) return null;

  const ibps = parseFloat(String(input_bps)) || 0;
  const obps = parseFloat(String(output_bps)) || 0;
  const maxBps = Math.max(ibps, obps);
  const capBps = parseInt(String(portSpeed), 10) * 1_000_000;

  return Math.min(100, Math.round((maxBps / capBps) * 100));
}

export function fmtBps(bps?: number | string): string {
  const b = parseFloat(String(bps)) || 0;

  if (b >= 1e9) return (b / 1e9).toFixed(2) + " Gbps";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " Mbps";
  if (b >= 1e3) return (b / 1e3).toFixed(1) + " Kbps";

  return b.toFixed(0) + " bps";
}

export function fmtMetric(v?: number | null): string {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return Number(v).toLocaleString();
}

export function utilColor(pct?: number | null): string {
  if (pct === null || pct === undefined) return T.text3;
  if (pct >= 90) return T.red;
  if (pct >= 70) return T.amber;
  if (pct >= 40) return T.purple;
  return T.green;
}

export function getSeverityColor(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return T.red;
    case "HIGH":
      return T.amber;
    case "MEDIUM":
      return T.purple;
    case "LOW":
      return T.green;
    default:
      return T.text3;
  }
}

export function getSeverityBg(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "rgba(255,90,90,.08)";
    case "HIGH":
      return "rgba(255,179,71,.08)";
    case "MEDIUM":
      return "rgba(155,127,255,.08)";
    case "LOW":
      return "rgba(45,206,138,.08)";
    default:
      return T.bg3;
  }
}

export function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function impactLabel(impact: string): string {
  switch (impact) {
    case "CRITICAL":
      return "🔴 CRITICAL";
    case "HIGH":
      return "🟠 HIGH";
    case "MEDIUM":
      return "🟣 MEDIUM";
    case "LOW":
      return "🟢 LOW";
    default:
      return "—";
  }
}
