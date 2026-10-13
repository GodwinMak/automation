import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import {
  ChevronRight,
  Search,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
// Shape matches GET /optics/power exactly (see opticsPowerController.js /
// groupByDevice): an array of devices, each with a flat list of interfaces.

type Status = "alarm" | "warning" | "normal" | "nodata";
type Filter = "all" | Status;

interface RawInterface {
  raw_interface: string;
  neighbor_name: string | null;
  port_speed: string | null;
  state: "Up" | "Down";
  tx_power_dbm: string | null; // JSON-stringified number array, e.g. "[-0.32,-0.96,-0.99,-1.85]"
  rx_power_dbm: string | null;
  tx_high_alarm_dbm: number | null;
  tx_low_alarm_dbm: number | null;
  tx_high_warning_dbm: number | null;
  tx_low_warning_dbm: number | null;
  rx_high_alarm_dbm: number | null;
  rx_low_alarm_dbm: number | null;
  rx_high_warning_dbm: number | null;
  rx_low_warning_dbm: number | null;
  last_power_checked: string | null;
}

interface RawDevice {
  device_id: string;
  device_name: string;
  device_ip: string;
  interfaces: RawInterface[];
}

interface Lane {
  value: number | null;
  status: Status;
  hiAlarm: number | null;
  loAlarm: number | null;
  hiWarn: number | null;
  loWarn: number | null;
}

interface EnrichedInterface extends RawInterface {
  txLanes: Lane[];
  rxLanes: Lane[];
  status: Status;
}

interface EnrichedDevice extends RawDevice {
  interfaces: EnrichedInterface[];
  status: Status;
  counts: Record<Status, number>;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_RANK: Record<Status, number> = { alarm: 3, warning: 2, normal: 1, nodata: 0 };
const STATUS_LABEL: Record<Status, string> = { alarm: "Alarm", warning: "Warning", normal: "Normal", nodata: "No optics" };
const STATUS_DOT: Record<Status, string> = { alarm: "bg-[#F0464B]", warning: "bg-[#F5A623]", normal: "bg-[#3FBF7F]", nodata: "bg-[#4B5866]" };
const STATUS_TEXT: Record<Status, string> = { alarm: "text-[#F0464B]", warning: "text-[#F5A623]", normal: "text-[#3FBF7F]", nodata: "text-[#7C8A9A]" };
const STATUS_BORDER: Record<Status, string> = { alarm: "border-[#F0464B]/50", warning: "border-[#F5A623]/50", normal: "border-[#232C38]", nodata: "border-[#232C38]" };
const STATUS_PILL_BG: Record<Status, string> = { alarm: "bg-[#F0464B]/15 text-[#F0464B]", warning: "bg-[#F5A623]/15 text-[#F5A623]", normal: "bg-[#3FBF7F]/15 text-[#3FBF7F]", nodata: "bg-[#4B5866]/15 text-[#7C8A9A]" };
const STATUS_WORD: Record<Status, string> = { alarm: "ALARM", warning: "WARN", normal: "OK", nodata: "—" };

function safeParseArray(text: string | null): number[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.filter((n) => typeof n === "number" && !Number.isNaN(n)) : [];
  } catch {
    return [];
  }
}

function laneStatus(
  value: number,
  hiAlarm: number | null,
  loAlarm: number | null,
  hiWarn: number | null,
  loWarn: number | null
): Status {
  if (value === null || value === undefined) return "nodata";
  if (hiAlarm !== null && hiAlarm !== undefined && value >= hiAlarm) return "alarm";
  if (loAlarm !== null && loAlarm !== undefined && value <= loAlarm) return "alarm";
  if (hiWarn !== null && hiWarn !== undefined && value >= hiWarn) return "warning";
  if (loWarn !== null && loWarn !== undefined && value <= loWarn) return "warning";
  return "normal";
}

function worst(a: Status, b: Status): Status {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function enrichInterface(iface: RawInterface): EnrichedInterface {
  const tx = safeParseArray(iface.tx_power_dbm);
  const rx = safeParseArray(iface.rx_power_dbm);

  const txLanes: Lane[] = tx.map((v) => ({
    value: v,
    status: laneStatus(v, iface.tx_high_alarm_dbm, iface.tx_low_alarm_dbm, iface.tx_high_warning_dbm, iface.tx_low_warning_dbm),
    hiAlarm: iface.tx_high_alarm_dbm,
    loAlarm: iface.tx_low_alarm_dbm,
    hiWarn: iface.tx_high_warning_dbm,
    loWarn: iface.tx_low_warning_dbm,
  }));
  const rxLanes: Lane[] = rx.map((v) => ({
    value: v,
    status: laneStatus(v, iface.rx_high_alarm_dbm, iface.rx_low_alarm_dbm, iface.rx_high_warning_dbm, iface.rx_low_warning_dbm),
    hiAlarm: iface.rx_high_alarm_dbm,
    loAlarm: iface.rx_low_alarm_dbm,
    hiWarn: iface.rx_high_warning_dbm,
    loWarn: iface.rx_low_warning_dbm,
  }));

  let ifaceStatus: Status = txLanes.length === 0 && rxLanes.length === 0 ? "nodata" : "normal";
  for (const l of [...txLanes, ...rxLanes]) ifaceStatus = worst(ifaceStatus, l.status);

  return { ...iface, txLanes, rxLanes, status: ifaceStatus };
}

function enrichDevice(device: RawDevice): EnrichedDevice {
  const interfaces = (device.interfaces || []).map(enrichInterface);
  let deviceStatus: Status = "nodata";
  for (const i of interfaces) deviceStatus = worst(deviceStatus, i.status);
  const counts: Record<Status, number> = { alarm: 0, warning: 0, normal: 0, nodata: 0 };
  interfaces.forEach((i) => counts[i.status]++);
  return { ...device, interfaces, status: deviceStatus, counts };
}

function fmtDbm(v: number | null): string {
  return v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "unknown";
  const s = Math.round(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ─── Gauge ────────────────────────────────────────────────────────────────────
// Small horizontal bar showing a reading against its own alarm/warning bounds.
// Self-labeled (prints its own low/high alarm values) so no legend is needed.

const Gauge: React.FC<{ lane: Lane }> = ({ lane }) => {
  const { value, hiAlarm, loAlarm, hiWarn, loWarn, status } = lane;
  if (hiAlarm === null || hiAlarm === undefined || loAlarm === null || loAlarm === undefined) {
    return <span className="text-xs font-mono text-[#4B5866]">no thresholds configured</span>;
  }
  const pad = Math.max((hiAlarm - loAlarm) * 0.12, 0.5);
  const min = loAlarm - pad;
  const max = hiAlarm + pad;
  const span = max - min;
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));

  const W = 180;
  const H = 30;
  const barY = 6;
  const barH = 6;
  const warnLoPct = pct(loWarn ?? loAlarm);
  const warnHiPct = pct(hiWarn ?? hiAlarm);
  const alarmLoPct = pct(loAlarm);
  const alarmHiPct = pct(hiAlarm);
  const markerPct = pct(value ?? min);
  const dotColor = status === "alarm" ? "#F0464B" : status === "warning" ? "#F5A623" : "#3FBF7F";
  const x = (p: number) => (p / 100) * W;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0"
      role="img"
      aria-label={`reading ${fmtDbm(value)} dBm, alarm bounds ${fmtDbm(loAlarm)} to ${fmtDbm(hiAlarm)} dBm`}
    >
      <rect x={0} y={barY} width={W} height={barH} rx={3} fill="#232C38" />
      <rect x={0} y={barY} width={x(alarmLoPct)} height={barH} rx={3} fill="#F0464B" opacity={0.55} />
      <rect x={x(alarmHiPct)} y={barY} width={W - x(alarmHiPct)} height={barH} rx={3} fill="#F0464B" opacity={0.55} />
      <rect x={x(alarmLoPct)} y={barY} width={Math.max(0, x(warnLoPct) - x(alarmLoPct))} height={barH} fill="#F5A623" opacity={0.5} />
      <rect x={x(warnHiPct)} y={barY} width={Math.max(0, x(alarmHiPct) - x(warnHiPct))} height={barH} fill="#F5A623" opacity={0.5} />
      <line x1={x(markerPct)} y1={1} x2={x(markerPct)} y2={barY + barH + 3} stroke={dotColor} strokeWidth={2} />
      <circle cx={x(markerPct)} cy={barY + barH / 2} r={4.5} fill={dotColor} stroke="#0A0E13" strokeWidth={1.5} />
      <text x={0} y={barY + barH + 14} fontSize={9} fontFamily="ui-monospace, monospace" fill="#7C8A9A">
        {loAlarm.toFixed(1)}
      </text>
      <text x={W} y={barY + barH + 14} fontSize={9} fontFamily="ui-monospace, monospace" fill="#7C8A9A" textAnchor="end">
        {hiAlarm.toFixed(1)}
      </text>
    </svg>
  );
};

// ─── Threshold summary + lane rows ────────────────────────────────────────────

const ThresholdLine: React.FC<{ hiAlarm: number | null; loAlarm: number | null; hiWarn: number | null; loWarn: number | null }> = ({
  hiAlarm,
  loAlarm,
  hiWarn,
  loWarn,
}) => {
  if (hiAlarm === null || hiAlarm === undefined || loAlarm === null || loAlarm === undefined) return null;
  const Item = ({ label, val, colorClass }: { label: string; val: number | null; colorClass: string }) =>
    val === null || val === undefined ? null : (
      <div className="flex items-center justify-between gap-2">
        <span className={`${colorClass} font-semibold`}>{label}</span>
        <span className="text-[#7C8A9A]">{val.toFixed(2)} dBm</span>
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mb-2 rounded border border-[#232C38]/70 bg-[#0A0E13]/40 px-2 py-1.5 text-[10px] font-mono">
      <Item label="High Alarm" val={hiAlarm} colorClass="text-[#F0464B]" />
      <Item label="High Warning" val={hiWarn} colorClass="text-[#F5A623]" />
      <Item label="Low Alarm" val={loAlarm} colorClass="text-[#F0464B]" />
      <Item label="Low Warning" val={loWarn} colorClass="text-[#F5A623]" />
    </div>
  );
};

const LaneRows: React.FC<{ lanes: Lane[]; label: string }> = ({ lanes, label }) => {
  if (lanes.length === 0) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs font-mono text-[#7C8A9A]">{label}</span>
        <span className="text-xs font-mono text-[#4B5866]">no optics</span>
      </div>
    );
  }
  return (
    <>
      {lanes.map((lane, idx) => (
        <div key={idx} className="flex items-center gap-3 py-1.5">
          <span className="w-10 shrink-0 text-xs font-mono text-[#7C8A9A]">{lanes.length > 1 ? `Lane ${idx + 1}` : label}</span>
          <span className={`w-20 shrink-0 text-right text-sm font-mono ${STATUS_TEXT[lane.status]}`}>
            {fmtDbm(lane.value)} <span className="text-[10px] text-[#7C8A9A]">dBm</span>
          </span>
          <span className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-mono font-semibold ${STATUS_PILL_BG[lane.status]}`}>
            {STATUS_WORD[lane.status]}
          </span>
          <Gauge lane={lane} />
        </div>
      ))}
    </>
  );
};

// ─── Interface card ────────────────────────────────────────────────────────────

const InterfaceCard: React.FC<{ iface: EnrichedInterface }> = ({ iface }) => (
  <div className={`rounded-md border ${STATUS_BORDER[iface.status]} bg-[#17202B]/60 px-3 py-3`}>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[iface.status]}`} />
        <span className="font-mono text-sm text-[#E7EDF3]">{iface.raw_interface || "—"}</span>
        {iface.port_speed && (
          <span className="text-[10px] font-mono text-[#7C8A9A] border border-[#232C38] rounded px-1.5 py-0.5">{iface.port_speed}</span>
        )}
      </div>
      <span className="text-xs font-mono text-[#7C8A9A]">&rarr; {iface.neighbor_name || "unknown"}</span>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1 divide-y divide-[#232C38]/60 lg:divide-y-0">
      <div>
        <div className="flex items-center gap-1.5 mb-0.5 text-[10px] font-mono uppercase tracking-wider text-[#7C8A9A]">
          <ArrowUp className="h-3 w-3" strokeWidth={2.5} />
          TX &middot; laser output power
        </div>
        <ThresholdLine
          hiAlarm={iface.tx_high_alarm_dbm}
          loAlarm={iface.tx_low_alarm_dbm}
          hiWarn={iface.tx_high_warning_dbm}
          loWarn={iface.tx_low_warning_dbm}
        />
        <LaneRows lanes={iface.txLanes} label="TX" />
      </div>
      <div className="pt-2 lg:pt-0">
        <div className="flex items-center gap-1.5 mb-0.5 text-[10px] font-mono uppercase tracking-wider text-[#7C8A9A]">
          <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
          RX &middot; laser receive power
        </div>
        <ThresholdLine
          hiAlarm={iface.rx_high_alarm_dbm}
          loAlarm={iface.rx_low_alarm_dbm}
          hiWarn={iface.rx_high_warning_dbm}
          loWarn={iface.rx_low_warning_dbm}
        />
        <LaneRows lanes={iface.rxLanes} label="RX" />
      </div>
    </div>
    <div className="mt-2 text-[10px] font-mono text-[#7C8A9A]">checked {relativeTime(iface.last_power_checked)}</div>
  </div>
);

// ─── Device card ────────────────────────────────────────────────────────────

const DeviceCard: React.FC<{
  device: EnrichedDevice;
  expanded: boolean;
  onToggle: () => void;
}> = ({ device, expanded, onToggle }) => {
  const countPills = (["alarm", "warning"] as Status[]).filter((k) => device.counts[k] > 0);
  const sortedInterfaces = useMemo(
    () => [...device.interfaces].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]),
    [device.interfaces]
  );

  return (
    <div className={`rounded-lg border ${STATUS_BORDER[device.status]} bg-[#121821] overflow-hidden`}>
      <button
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#17202B]/60 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-[#7C8A9A] transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium truncate text-[#E7EDF3]">{device.device_name || "unnamed device"}</span>
              <span className="text-xs font-mono text-[#7C8A9A] hidden sm:inline">{device.device_ip || ""}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-mono text-[#7C8A9A]">
              <span>
                {device.interfaces.length} interface{device.interfaces.length === 1 ? "" : "s"}
              </span>
              {countPills.length > 0 && (
                <>
                  <span className="text-[#232C38]">&middot;</span>
                  {countPills.map((k, i) => (
                    <React.Fragment key={k}>
                      {i > 0 && <span className="text-[#232C38]">&middot;</span>}
                      <span className={`text-[11px] font-mono ${STATUS_TEXT[k]}`}>
                        {device.counts[k]} {k}
                      </span>
                    </React.Fragment>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border ${STATUS_BORDER[device.status]} px-2 py-0.5 text-xs font-mono ${STATUS_TEXT[device.status]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[device.status]}`} />
          {STATUS_LABEL[device.status]}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[#232C38] px-4 py-3 space-y-2 bg-[#0A0E13]/40">
          {sortedInterfaces.map((iface) => (
            <InterfaceCard key={iface.raw_interface} iface={iface} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

const FILTER_CHIPS: { key: Filter; label: string; colorClass: string }[] = [
  { key: "all", label: "Devices", colorClass: "text-[#E7EDF3]" },
  { key: "alarm", label: "Alarm", colorClass: "text-[#F0464B]" },
  { key: "warning", label: "Warning", colorClass: "text-[#F5A623]" },
  { key: "normal", label: "Normal", colorClass: "text-[#3FBF7F]" },
  { key: "nodata", label: "No optics", colorClass: "text-[#7C8A9A]" },
];

const OpticsPower: React.FC = () => {
  const [devices, setDevices] = useState<EnrichedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const autoExpandedOnce = useRef(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/optics`, { withCredentials: true });
      const raw: RawDevice[] = res.data || [];
      const enriched = raw.map(enrichDevice);
      setDevices(enriched);
      setLastUpdated(new Date());

      // Auto-expand devices with an alarm/warning the first time data loads,
      // same behaviour as the dashboard's original prototype.
      if (!autoExpandedOnce.current) {
        autoExpandedOnce.current = true;
        const toExpand = enriched.filter((d) => d.status === "alarm" || d.status === "warning").map((d) => d.device_id);
        setExpandedIds(new Set(toExpand));
      }
    } catch (err: any) {
      console.error("Error fetching optics power data:", err);
      setError(err?.response?.data?.message || "Failed to load optics power data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const totals: Record<Status, number> = { alarm: 0, warning: 0, normal: 0, nodata: 0 };
    devices.forEach((d) => d.interfaces.forEach((i) => totals[i.status]++));
    return { devices: devices.length, ...totals };
  }, [devices]);

  const visibleDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesSearch = (d: EnrichedDevice) => {
      if (!q) return true;
      const hay = [d.device_name, d.device_ip, ...d.interfaces.flatMap((i) => [i.raw_interface, i.neighbor_name])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    };
    const matchesFilter = (d: EnrichedDevice) => {
      if (filter === "all") return true;
      if (filter === "nodata") return d.interfaces.every((i) => i.status === "nodata");
      return d.counts[filter] > 0;
    };
    return devices
      .filter((d) => matchesSearch(d) && matchesFilter(d))
      .sort((a, b) => {
        if (STATUS_RANK[b.status] !== STATUS_RANK[a.status]) return STATUS_RANK[b.status] - STATUS_RANK[a.status];
        return (a.device_name || "").localeCompare(b.device_name || "");
      });
  }, [devices, search, filter]);

  const toggleDevice = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedIds(new Set(visibleDevices.map((d) => d.device_id)));
  const collapseAll = () => setExpandedIds(new Set());

  return (
    <div className="min-h-screen bg-[#0A0E13] text-[#E7EDF3] font-sans antialiased">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 border-b border-[#232C38] bg-[#0A0E13]/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-semibold tracking-tight">Optics Power</h1>
              <span className="text-xs font-mono text-[#7C8A9A]">Liquid Technologies &middot; NOC</span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-[#7C8A9A]">
                <span className={`h-2 w-2 rounded-full ${error ? "bg-[#F0464B]" : loading ? "bg-[#4B5866]" : "bg-[#3FBF7F]"}`} />
                {error ? "error" : loading ? "loading…" : `live · ${stats.devices} nodes`}
              </span>
              {lastUpdated && <span className="text-[#7C8A9A]">updated {relativeTime(lastUpdated.toISOString())}</span>}
              <button
                onClick={load}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-md border border-[#232C38] bg-[#121821] px-3 py-1.5 text-[#E7EDF3] hover:bg-[#17202B] transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </button>
            </div>
          </div>

          {/* Stat strip */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {FILTER_CHIPS.map((chip) => (
              <button
                key={chip.key}
                onClick={() => setFilter(chip.key)}
                className={`rounded-lg border bg-[#121821] px-3 py-2 text-left transition-colors hover:bg-[#17202B] ${
                  filter === chip.key ? "border-[#34D9C4] ring-1 ring-[#34D9C4]" : "border-[#232C38]"
                }`}
              >
                <div className={`text-xs ${chip.colorClass}`}>{chip.label}</div>
                <div className={`font-mono text-xl font-semibold ${chip.colorClass}`}>
                  {chip.key === "all" ? stats.devices : stats[chip.key]}
                </div>
              </button>
            ))}
          </div>

          {/* Search + expand controls */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search device, IP, neighbor, or interface…"
                className="w-full rounded-md border border-[#232C38] bg-[#121821] px-3 py-2 pl-9 text-sm font-mono placeholder:text-[#7C8A9A] focus:bg-[#17202B] outline-none text-[#E7EDF3]"
              />
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#7C8A9A]" strokeWidth={2} />
            </div>
            <button
              onClick={expandAll}
              className="rounded-md border border-[#232C38] bg-[#121821] px-3 py-2 text-xs font-mono text-[#7C8A9A] hover:bg-[#17202B] hover:text-[#E7EDF3] transition-colors"
            >
              Expand all
            </button>
            <button
              onClick={collapseAll}
              className="rounded-md border border-[#232C38] bg-[#121821] px-3 py-2 text-xs font-mono text-[#7C8A9A] hover:bg-[#17202B] hover:text-[#E7EDF3] transition-colors"
            >
              Collapse all
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-[#F0464B]/40 bg-[#F0464B]/10 px-4 py-3 text-sm text-[#F0464B]">{error}</div>
        )}

        {loading && devices.length === 0 ? (
          <div className="rounded-lg border border-[#232C38] bg-[#121821]/40 px-6 py-16 text-center">
            <p className="font-mono text-sm text-[#7C8A9A]">Loading optics power data…</p>
          </div>
        ) : visibleDevices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#232C38] bg-[#121821]/40 px-6 py-16 text-center">
            <p className="font-mono text-sm text-[#7C8A9A]">No devices match this view.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleDevices.map((device) => (
              <DeviceCard
                key={device.device_id}
                device={device}
                expanded={expandedIds.has(device.device_id)}
                onToggle={() => toggleDevice(device.device_id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default OpticsPower;