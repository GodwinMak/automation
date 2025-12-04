import React, { useState, useMemo } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, Download, Loader2, CheckCircle2, AlertCircle, Wifi, RefreshCw, Database } from "lucide-react";

// Zabbix API helper
const zabbixApi = async (payload: any) => {
  const res = await axios.post(
    "https://monitoring.liquidtelecom.net/api_jsonrpc.php",
    {
      jsonrpc: "2.0",
      ...payload,
    },
    {
      headers: { "Content-Type": "application/json" },
    }
  );
  return res.data.result;
};

// GPON Configuration
const GPON_CONFIG = {
  switchName: "LTZ-BNG01-RAH-DAR",
  zabbixHost: "LTZ-BNG01-RAH-DAR", // Adjust if different
  interface: "xe-0/1/0",
};

// Calculate 95th percentile using exact Zabbix method
// const calcP95 = (values: number[]) => {
//   if (!values.length) return 0;
  
//   const sorted = [...values].sort((a, b) => a - b);
//   const n = sorted.length;
  
//   const position = n * 0.95;
  
//   if (position % 1 !== 0) {
//     const index = Math.ceil(position) - 1;
//     return sorted[Math.min(index, n - 1)];
//   } else {
//     const index1 = position - 1;
//     const index2 = position;
    
//     if (index2 >= n) {
//       return sorted[index1];
//     }
    
//     return (sorted[index1] + sorted[index2]) / 2;
//   }
// };
const calcP95 = (values: number[]) => {
  if (!values.length) return 0;

  const max = Math.max(...values);

  let filtered = values;

  // Apply filtering ONLY if max >= 1 Gbps
  if (max >= 1_000_000_000) {
    const threshold = max * 0.00001; // ignore extremely small samples
    filtered = values.filter(v => v >= threshold);
  }

  if (!filtered.length) return 0;

  const sorted = [...filtered].sort((a, b) => a - b);
  const n = sorted.length;

  const position = n * 0.95;

  if (position % 1 !== 0) {
    const index = Math.ceil(position) - 1;
    return sorted[Math.min(index, n - 1)];
  } else {
    const index1 = position - 1;
    const index2 = position;
    if (index2 >= n) return sorted[index1];
    return (sorted[index1] + sorted[index2]) / 2;
  }
};

interface GponStats {
  p95Sent: number;
  p95Recv: number;
  p95Combined: number;
  maxSent: number;
  maxRecv: number;
  avgSent: number;
  avgRecv: number;
  samples: number;
  dataSource: "history" | "trends";
  unit: string;
}

const GponPercentileReport = () => {
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<GponStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queryDateRange, setQueryDateRange] = useState<{ start: string; end: string } | null>(null);
  const [loadedFromDb, setLoadedFromDb] = useState(false);

  // Generate available months (last 12 months)
  const availableMonths = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      months.push({ value, label });
    }
    return months;
  }, []);

  // Check and load from database when month changes
  const loadFromDatabase = async () => {
    if (!selectedMonth) return;
    
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/percentile-reports?month=${selectedMonth}&reportType=GPON`
      );
      
      const dbReports = res.data.reports || [];
      
      if (dbReports.length > 0) {
        const r = dbReports[0];
        if (r.status === "success") {
          // Determine divisor based on stored unit
          const divisor = r.displayUnit === "Gbps" ? 1e9 : r.displayUnit === "Mbps" ? 1e6 : r.displayUnit === "Kbps" ? 1e3 : 1;
          
          setStats({
            p95Sent: r.p95Sent / divisor,
            p95Recv: r.p95Recv / divisor,
            p95Combined: r.p95Combined / divisor,
            maxSent: 0,
            maxRecv: 0,
            avgSent: 0,
            avgRecv: 0,
            samples: r.samples || 0,
            dataSource: r.dataSource || "trends",
            unit: r.displayUnit || "Mbps",
          });
          setLoadedFromDb(true);
          console.log("Loaded GPON report from database");
        } else {
          setError(r.errorMessage || "Previous report had error");
          setLoadedFromDb(false);
        }
      } else {
        setStats(null);
        setLoadedFromDb(false);
      }
    } catch (err) {
      console.error("Error loading from database:", err);
      setLoadedFromDb(false);
    } finally {
      setLoading(false);
    }
  };

  // Load from database when month changes
  React.useEffect(() => {
    if (selectedMonth) {
      loadFromDatabase();
    }
  }, [selectedMonth]);

  const generateReport = async (forceRegenerate = false) => {
    if (!selectedMonth) return;
    
    if (loadedFromDb && !forceRegenerate) {
      return;
    }
    
    setLoadedFromDb(false);
    if (!selectedMonth) return;

    setLoading(true);
    setError(null);
    setStats(null);

    try {
      const auth = localStorage.getItem("zabbixAuth");
      const [year, month] = selectedMonth.split("-").map(Number);
      
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      
      const time_from = Math.floor(startDate.getTime() / 1000);
      const time_till = Math.floor(endDate.getTime() / 1000);

      setQueryDateRange({
        start: startDate.toLocaleString("en-GB", { 
          day: "2-digit", month: "short", year: "numeric", 
          hour: "2-digit", minute: "2-digit", second: "2-digit" 
        }),
        end: endDate.toLocaleString("en-GB", { 
          day: "2-digit", month: "short", year: "numeric", 
          hour: "2-digit", minute: "2-digit", second: "2-digit" 
        }),
      });

      console.log(`GPON Report: Querying ${GPON_CONFIG.switchName} - ${GPON_CONFIG.interface}`);
      console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Get Zabbix host ID
      const host = await zabbixApi({
        method: "host.get",
        params: {
          output: ["hostid"],
          filter: { host: [GPON_CONFIG.zabbixHost] },
        },
        id: 1,
        auth,
      });

      if (!host || !host[0]?.hostid) {
        throw new Error(`Host not found: ${GPON_CONFIG.zabbixHost}`);
      }

      // Get graph items for the interface
      const graph = await zabbixApi({
        method: "graph.get",
        params: {
          hostids: [host[0].hostid],
          search: { name: GPON_CONFIG.interface },
          output: "extend",
          selectItems: "extend",
        },
        id: 1,
        auth,
      });

      if (!graph || !graph.length) {
        throw new Error(`Graph not found for interface: ${GPON_CONFIG.interface}`);
      }

      const itemids = graph[0].items.map((item: any) => item.itemid);

      if (itemids.length < 2) {
        throw new Error(`Insufficient items found: ${itemids.length}`);
      }

      // Try to get history data first
      let history = await zabbixApi({
        method: "history.get",
        params: {
          history: 3,
          itemids,
          time_from,
          time_till,
          output: "extend",
          sortfield: "clock",
          sortorder: "ASC",
        },
        id: 1,
        auth,
      });

      let sentValues: number[] = [];
      let recvValues: number[] = [];
      let dataSource: "history" | "trends" = "history";

      if (history && history.length > 0) {
        const sentData = history.filter((d: any) => d.itemid === itemids[0]);
        const recvData = history.filter((d: any) => d.itemid === itemids[1]);
        sentValues = sentData.map((d: any) => Number(d.value));
        recvValues = recvData.map((d: any) => Number(d.value));
      } else {
        // Fall back to trends
        const trends = await zabbixApi({
          method: "trend.get",
          params: {
            itemids,
            time_from,
            time_till,
            output: "extend",
          },
          id: 1,
          auth,
        });

        if (!trends || trends.length === 0) {
          throw new Error("No history or trends data available for selected month");
        }

        const sentTrends = trends.filter((d: any) => d.itemid === itemids[0]);
        const recvTrends = trends.filter((d: any) => d.itemid === itemids[1]);
        sentValues = sentTrends.map((d: any) => Number(d.value_avg));
        recvValues = recvTrends.map((d: any) => Number(d.value_avg));
        dataSource = "trends";
      }

      if (sentValues.length === 0 && recvValues.length === 0) {
        throw new Error("No data available for selected month");
      }

      // Calculate stats
      const p95Sent = calcP95(sentValues);
      const p95Recv = calcP95(recvValues);
      // Billing is MAX of sent or recv 95th percentile (industry standard)
      const combinedValues = [...sentValues, ...recvValues];
      const p95Combined = calcP95(combinedValues);

      const maxSent = sentValues.length ? Math.max(...sentValues) : 0;
      const maxRecv = recvValues.length ? Math.max(...recvValues) : 0;
      const avgSent = sentValues.length ? sentValues.reduce((a, b) => a + b, 0) / sentValues.length : 0;
      const avgRecv = recvValues.length ? recvValues.reduce((a, b) => a + b, 0) / recvValues.length : 0;

      // Determine unit
      const maxValue = Math.max(p95Combined, maxSent, maxRecv);
      let displayUnit = "bps";
      let divisor = 1;
      if (maxValue > 1_000_000_000) {
        displayUnit = "Gbps";
        divisor = 1_000_000_000;
      } else if (maxValue > 1_000_000) {
        displayUnit = "Mbps";
        divisor = 1_000_000;
      } else if (maxValue > 1_000) {
        displayUnit = "Kbps";
        divisor = 1_000;
      }

      const statsData = {
        p95Sent: p95Sent / divisor,
        p95Recv: p95Recv / divisor,
        p95Combined: p95Combined / divisor,
        maxSent: maxSent / divisor,
        maxRecv: maxRecv / divisor,
        avgSent: avgSent / divisor,
        avgRecv: avgRecv / divisor,
        samples: Math.max(sentValues.length, recvValues.length),
        dataSource,
        unit: displayUnit,
      };

      setStats(statsData);

      // Save to database
      try {
        await axios.post(`${PRODUCTION_URL}/percentile-reports`, {
          reportType: "GPON",
          month: selectedMonth,
          customerId: "GPON",
          customerName: "GPON Interface",
          switchName: GPON_CONFIG.switchName,
          interface: GPON_CONFIG.interface,
          p95Sent: p95Sent,
          p95Recv: p95Recv,
          p95Combined: p95Combined,
          displayUnit: displayUnit,
          dataSource: dataSource,
          samples: Math.max(sentValues.length, recvValues.length),
          status: "success",
        });
        console.log("Saved GPON report to database");
      } catch (saveErr) {
        console.error("Error saving GPON report:", saveErr);
      }

    } catch (err: any) {
      console.error("Error generating GPON report:", err);
      setError(err.message || "Failed to generate report");

      // Save error to database
      try {
        await axios.post(`${PRODUCTION_URL}/percentile-reports`, {
          reportType: "GPON",
          month: selectedMonth,
          customerId: "GPON",
          customerName: "GPON Interface",
          switchName: GPON_CONFIG.switchName,
          interface: GPON_CONFIG.interface,
          status: "error",
          errorMessage: err.message,
        });
      } catch (saveErr) {
        console.error("Error saving GPON error report:", saveErr);
      }
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (!stats) return;
    
    const monthLabel = availableMonths.find((m) => m.value === selectedMonth)?.label || selectedMonth;
    const reportData = {
      title: "GPON 95th Percentile Report",
      month: monthLabel,
      switch: GPON_CONFIG.switchName,
      interface: GPON_CONFIG.interface,
      dateRange: queryDateRange,
      stats: {
        "95th Percentile (Combined)": `${stats.p95Combined.toFixed(2)} ${stats.unit}`,
        "95th Percentile (Sent)": `${stats.p95Sent.toFixed(2)} ${stats.unit}`,
        "95th Percentile (Received)": `${stats.p95Recv.toFixed(2)} ${stats.unit}`,
        "Maximum (Sent)": `${stats.maxSent.toFixed(2)} ${stats.unit}`,
        "Maximum (Received)": `${stats.maxRecv.toFixed(2)} ${stats.unit}`,
        "Average (Sent)": `${stats.avgSent.toFixed(2)} ${stats.unit}`,
        "Average (Received)": `${stats.avgRecv.toFixed(2)} ${stats.unit}`,
        "Data Points": stats.samples,
        "Data Source": stats.dataSource,
      },
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gpon-95th-percentile-${selectedMonth}.json`;
    a.click();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
            <Wifi className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">GPON 95th Percentile Report</h1>
            <p className="text-muted-foreground">
              Monthly bandwidth report for GPON interface
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Info */}
      <Card className="border-purple-500/30 bg-purple-500/5">
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <Wifi className="h-8 w-8 text-purple-400" />
            <div>
              <p className="font-medium text-purple-300">GPON Interface Configuration</p>
              <p className="text-sm text-muted-foreground">
                Switch: <span className="font-mono text-white">{GPON_CONFIG.switchName}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Interface: <span className="font-mono text-white">{GPON_CONFIG.interface}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Generate Report</CardTitle>
          <CardDescription>
            Select a month to calculate the 95th percentile bandwidth usage for GPON
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Month</label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {availableMonths.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loadedFromDb ? (
              <Button
                onClick={() => generateReport(true)}
                disabled={loading}
                variant="outline"
                className="border-purple-500 text-purple-500 hover:bg-purple-500/10"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerate Report
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={() => generateReport(false)}
                disabled={!selectedMonth || loading}
                className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Report"
                )}
              </Button>
            )}

            {stats && (
              <Button variant="outline" onClick={exportReport}>
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </Button>
            )}
          </div>

          {/* Loaded from Database Message */}
          {loadedFromDb && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 text-green-400">
                <Database className="h-4 w-4" />
                <span className="font-medium">Loaded from Database</span>
              </div>
              <p className="text-muted-foreground mt-1">
                Report data was loaded from the database. Click "Regenerate Report" to fetch fresh data from Zabbix.
              </p>
            </div>
          )}

          {/* Date Range Display */}
          {queryDateRange && (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-sm">
              <div className="font-medium text-purple-400 mb-1">📅 Querying Date Range:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  <span className="text-gray-400">From:</span>{" "}
                  <span className="text-white font-mono">{queryDateRange.start}</span>
                </div>
                <div>
                  <span className="text-gray-400">To:</span>{" "}
                  <span className="text-white font-mono">{queryDateRange.end}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-500/50 bg-red-500/10">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {stats && (
        <div className="space-y-6">
          {/* Main 95th Percentile Card */}
          <Card className="border-purple-500/50 bg-gradient-to-br from-purple-500/10 to-pink-500/10">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-purple-300 mb-2">GPON 95th Percentile (Combined)</p>
                <p className="text-5xl font-bold text-purple-400">
                  {stats.p95Combined.toFixed(2)}
                  <span className="text-2xl ml-2">{stats.unit}</span>
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Badge variant="secondary" className={stats.dataSource === "trends" ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"}>
                    {stats.dataSource === "trends" ? "📊 Trends Data" : "📈 History Data"}
                  </Badge>
                  <Badge variant="secondary" className="bg-gray-500/20">
                    {stats.samples.toLocaleString()} samples
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Detailed Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Sent Stats */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-cyan-500"></span>
                  Outbound (Sent)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">95th Percentile:</span>
                    <span className="font-bold text-cyan-400">{stats.p95Sent.toFixed(2)} {stats.unit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Maximum:</span>
                    <span>{stats.maxSent.toFixed(2)} {stats.unit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Average:</span>
                    <span>{stats.avgSent.toFixed(2)} {stats.unit}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Received Stats */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-pink-500"></span>
                  Inbound (Received)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">95th Percentile:</span>
                    <span className="font-bold text-pink-400">{stats.p95Recv.toFixed(2)} {stats.unit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Maximum:</span>
                    <span>{stats.maxRecv.toFixed(2)} {stats.unit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Average:</span>
                    <span>{stats.avgRecv.toFixed(2)} {stats.unit}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Success indicator */}
          <div className="flex items-center justify-center gap-2 text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <span>Report generated successfully</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default GponPercentileReport;

