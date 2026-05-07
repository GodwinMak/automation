import {T} from "./Constants"

export function ifaceCapacity(iface, portSpeed) {
  if (portSpeed !== undefined && portSpeed !== null) {
    const ps = parseInt(String(portSpeed), 10);
    if (!isNaN(ps) && ps > 0) {
      if (ps === 100000) return 100;
      if (ps === 10000) return 10;
      return ps / 1000;
    }
  }
  return 1;
}

export function ifaceLabel(iface, portSpeed) {
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

export function trafficUtil(input_bps, output_bps, portSpeed) {
  if (!portSpeed || portSpeed <= 0) return null;
  const ibps = parseFloat(input_bps) || 0;
  const obps = parseFloat(output_bps) || 0;
  const maxBps = Math.max(ibps, obps);
  const capBps = parseInt(String(portSpeed), 10) * 1_000_000;
  return Math.min(100, Math.round((maxBps / capBps) * 100));
}

export function fmtBps(bps) {
  const b = parseFloat(bps) || 0;
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " Gbps";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " Mbps";
  return b.toFixed(0) + " bps";
}

export function fmtMetric(v) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return Number(v).toLocaleString();
}

export function utilColor(pct) {
  if (pct >= 90) return T.red;
  if (pct >= 70) return T.amber;
  if (pct >= 40) return T.purple;
  return T.green;
}
