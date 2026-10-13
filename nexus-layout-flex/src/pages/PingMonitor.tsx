import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Search, RefreshCw, Loader2, ArrowUp, ArrowDown } from "lucide-react";

// Shape matches GET /isis-adjacency/ping-monitor (see getPingMonitor in
// backend/Controller/isisAdjacent.js): packet loss / RTT per point-to-point IP
// from Prometheus, joined with the owning device and ISIS neighbor.

type Status = "unreachable" | "loss" | "ok" | "nodata";
type Filter = "all" | Status;

interface PingRow {
  ip: string;
  device: string;
  neighbor: string;
  interface: string;
  linkId: string | null;
  isisState: "Up" | "Down";
  level: number | null;
  lossPercent: number | null;
  avgRttMs: number | null;
  status: Status;
}

interface PingResponse {
  window: string;
  lossWarnPercent: number;
  rows: PingRow[];
}

type SortKey = "status" | "device" | "neighbor" | "ip" | "lossPercent" | "avgRttMs";

const STATUS_RANK: Record<Status, number> = { unreachable: 3, loss: 2, nodata: 1, ok: 0 };
const STATUS_LABEL: Record<Status, string> = { unreachable: "Unreachable", loss: "Packet loss", ok: "OK", nodata: "No data" };
const STATUS_TEXT: Record<Status, string> = { unreachable: "text-[#F0464B]", loss: "text-[#F5A623]", ok: "text-[#3FBF7F]", nodata: "text-[#7C8A9A]" };
const STATUS_PILL: Record<Status, string> = {
  unreachable: "bg-[#F0464B]/15 text-[#F0464B]",
  loss: "bg-[#F5A623]/15 text-[#F5A623]",
  ok: "bg-[#3FBF7F]/15 text-[#3FBF7F]",
  nodata: "bg-[#4B5866]/15 text-[#7C8A9A]",
};

const FILTER_CHIPS: { key: Filter; label: string }[] = [
  { key: "all", label: "All links" },
  { key: "unreachable", label: "Unreachable" },
  { key: "loss", label: "Packet loss" },
  { key: "ok", label: "OK" },
  { key: "nodata", label: "No data" },
];

const REFRESH_MS = 30000;

const PingMonitor: React.FC = () => {
  const [data, setData] = useState<PingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDesc, setSortDesc] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get<PingResponse>(`${PRODUCTION_URL}/isis-adjacency/ping-monitor`, {
        withCredentials: true,
      });
      setData(res.data);
      setLastUpdated(new Date());
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Failed to load ping results");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const rows = data?.rows ?? [];

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, unreachable: 0, loss: 0, ok: 0, nodata: 0 };
    rows.forEach((r) => {
      c[r.status] += 1;
    });
    return c;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return [r.device, r.neighbor, r.interface, r.ip].some((v) => (v || "").toLowerCase().includes(q));
    });

    const dir = sortDesc ? -1 : 1;
    const num = (v: number | null) => (v === null ? -1 : v);
    return filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "status":
          cmp = STATUS_RANK[a.status] - STATUS_RANK[b.status] || num(a.lossPercent) - num(b.lossPercent);
          break;
        case "lossPercent":
          cmp = num(a.lossPercent) - num(b.lossPercent);
          break;
        case "avgRttMs":
          cmp = num(a.avgRttMs) - num(b.avgRttMs);
          break;
        case "ip":
          cmp = a.ip.localeCompare(b.ip, undefined, { numeric: true });
          break;
        default:
          cmp = (a[sortKey] || "").localeCompare(b[sortKey] || "");
      }
      return cmp * dir || a.device.localeCompare(b.device);
    });
  }, [rows, search, filter, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(key === "status" || key === "lossPercent" || key === "avgRttMs");
    }
  };

  const Th: React.FC<{ k: SortKey; label: string; align?: "right" }> = ({ k, label, align }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`cursor-pointer select-none px-3 py-2 text-xs font-medium text-[#7C8A9A] hover:text-[#E7EDF3] ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && (sortDesc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </span>
    </th>
  );

  return (
    <div className="min-h-screen bg-[#0A0E13] text-[#E7EDF3] font-sans antialiased">
      <header className="sticky top-0 z-20 border-b border-[#232C38] bg-[#0A0E13]/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-semibold tracking-tight">Ping Monitor</h1>
              <span className="text-xs font-mono text-[#7C8A9A]">
                point-to-point links &middot; ISIS level above 1 &middot; loss over {data?.window ?? "5m"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-[#7C8A9A]">
                <span
                  className={`h-2 w-2 rounded-full ${error ? "bg-[#F0464B]" : loading && !data ? "bg-[#4B5866]" : "bg-[#3FBF7F]"}`}
                />
                {error ? "error" : `live · ${rows.length} IPs`}
              </span>
              {lastUpdated && <span className="text-[#7C8A9A]">updated {lastUpdated.toLocaleTimeString()}</span>}
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

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {FILTER_CHIPS.map((chip) => {
              const color = chip.key === "all" ? "text-[#E7EDF3]" : STATUS_TEXT[chip.key];
              return (
                <button
                  key={chip.key}
                  onClick={() => setFilter(chip.key)}
                  className={`rounded-lg border bg-[#121821] px-3 py-2 text-left transition-colors hover:bg-[#17202B] ${
                    filter === chip.key ? "border-[#34D9C4] ring-1 ring-[#34D9C4]" : "border-[#232C38]"
                  }`}
                >
                  <div className={`text-xs ${color}`}>{chip.label}</div>
                  <div className={`font-mono text-xl font-semibold ${color}`}>{counts[chip.key]}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7C8A9A]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search device, neighbor, interface or IP…"
                className="w-full rounded-md border border-[#232C38] bg-[#121821] px-3 py-2 pl-9 text-sm font-mono placeholder:text-[#7C8A9A] focus:bg-[#17202B] outline-none text-[#E7EDF3]"
              />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-4">
        {error && (
          <div className="mb-3 rounded-md border border-[#F0464B]/50 bg-[#F0464B]/10 px-3 py-2 text-sm text-[#F0464B]">
            {error}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-[#232C38] bg-[#121821]">
          <table className="w-full text-sm">
            <thead className="border-b border-[#232C38]">
              <tr>
                <Th k="status" label="Status" />
                <Th k="device" label="Device" />
                <Th k="neighbor" label="Neighbor" />
                <th className="px-3 py-2 text-left text-xs font-medium text-[#7C8A9A]">Interface</th>
                <Th k="ip" label="IP" />
                <Th k="lossPercent" label="Loss" align="right" />
                <Th k="avgRttMs" label="Avg RTT" align="right" />
                <th className="px-3 py-2 text-left text-xs font-medium text-[#7C8A9A]">Level</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-[#7C8A9A]">ISIS</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.ip} className="border-b border-[#232C38]/60 last:border-0 hover:bg-[#17202B]">
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_PILL[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium">{r.device}</td>
                  <td className="px-3 py-2">{r.neighbor}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[#7C8A9A]">{r.interface}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.ip}</td>
                  <td className={`px-3 py-2 text-right font-mono ${STATUS_TEXT[r.status]}`}>
                    {r.lossPercent === null ? "—" : `${r.lossPercent.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.avgRttMs === null ? "—" : `${r.avgRttMs.toFixed(2)} ms`}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.level ?? "—"}</td>
                  <td className={`px-3 py-2 text-xs ${r.isisState === "Down" ? "text-[#F0464B]" : "text-[#7C8A9A]"}`}>
                    {r.isisState}
                  </td>
                </tr>
              ))}
              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-[#7C8A9A]">
                    No links match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};

export default PingMonitor;
