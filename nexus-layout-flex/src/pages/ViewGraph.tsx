                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            import React, { useEffect, useState, useMemo } from "react";
import { Line } from "react-chartjs-2";
import axios from "axios";
import { useLocation } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
} from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           
  LineElement,
  Tooltip,
  Legend,
  Title,
  zoomPlugin
);

// const CustomLegend = {
//   id: "leftLegend",
//   afterDraw(chart) {
//     const ctx = chart.ctx;
//     const { datasets } = chart.data;

//     ctx.save();
//     ctx.font = "12px sans-serif";
//     ctx.textAlign = "left";
//     ctx.fillStyle = "white";

//     let x = 10;
//     let y = chart.height - 30;

//     datasets.forEach((ds) => {
//       // Color box
//       ctx.fillStyle = ds.borderColor;
//       ctx.fillRect(x, y, 12, 12);

//       // Text next to box
//       ctx.fillStyle = "white";
//       ctx.fillText(ds.label, x + 18, y + 10);

//       y += 20;
//     });

//     ctx.restore();
//   },
// };

// ChartJS.register(CustomLegend);

const ViewGraph = () => {
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const items = useMemo(() => {
    const fromStorage = JSON.parse(localStorage.getItem("zabbix_itemids"));
    return location.state?.items || fromStorage || [];
  }, [location.state?.items]);

  // Memoized IDs so useEffect does NOT trigger infinite renders
  const itemids = useMemo(() => items.map((i) => i.itemid), [items]);
  const customer = location.state?.customer;

  const [graphData, setGraphData] = useState<any>(null);
  const [stats, setStats] = useState<any>({});
  const [range, setRange] = useState("6h");
  const [unit, setUnit] = useState("bps");

  // Monthly 95th percentile report states
  const [selectedMonth, setSelectedMonth] = useState("");
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyStats, setMonthlyStats] = useState<any>(null);
  const [monthlyUnit, setMonthlyUnit] = useState("bps");

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

  const calcStats = (values) => {
    if (!values.length) return { max: 0, min: 0, avg: 0, p95: 0 };

    const nums = values.map(Number);
    const sorted = [...nums].sort((a, b) => a - b);
    const n = sorted.length;
    
    // Calculate 95th percentile using exact Zabbix method:
    // 1. position = n * 0.95
    // 2. If NOT whole: round UP, use that position
    // 3. If IS whole: average of position and position+1
    const position = n * 0.95;
    let p95;
    
    if (position % 1 !== 0) {
      // Not whole - round UP (1-based to 0-based index)
      const index = Math.ceil(position) - 1;
      p95 = sorted[Math.min(index, n - 1)];
    } else {
      // Whole number - average of position and position+1
      const index1 = position - 1;
      const index2 = position;
      p95 = index2 >= n ? sorted[index1] : (sorted[index1] + sorted[index2]) / 2;
    }
    
    return {
      max: Math.max(...nums),
      min: Math.min(...nums),
      avg: nums.reduce((a, b) => a + b, 0) / nums.length,
      p95: p95,
    };
  };

  const fetchHistory = async () => {
    if (!itemids || itemids.length < 2) return;

    setLoading(true); // start loading

    try {
      const auth = localStorage.getItem("zabbixAuth");
      const now = Math.floor(Date.now() / 1000);

      let hours = 6;
      if (range === "1h") hours = 1;
      if (range === "12h") hours = 12;
      if (range === "24h") hours = 24;
      if (range === "168h") hours = 168;
      if (range === "720h") hours = 720;

      const time_from = now - hours * 3600;

      const history = await axios.post(
        "https://monitoring.liquidtelecom.net/api_jsonrpc.php",
        {
          jsonrpc: "2.0",
          method: "history.get",
          params: {
            history: 3,
            itemids,
            time_from,
            time_till: now,
            output: "extend",
            sortfield: "clock",
            sortorder: "ASC",
          },
          id: 1,
          auth,
        },
        { headers: { "Content-Type": "application/json", Authorization: undefined, } }
      );

      const result = history.data.result;

      // Split by itemids
      const sentData = result.filter((d) => d.itemid === itemids[0]);
      const recvData = result.filter((d) => d.itemid === itemids[1]);

      const maxValue = Math.max(
        ...sentData.map((d) => Number(d.value)),
        ...recvData.map((d) => Number(d.value))
      );

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

      setUnit(displayUnit);

      const sentValues = sentData.map((d) => Number(d.value) / divisor);
      const recvValues = recvData.map((d) => Number(d.value) / divisor);
      setStats({
        sent: calcStats(sentValues),
        recv: calcStats(recvValues),
      });
      setGraphData({
        labels: sentData.map((d) =>
          new Date(d.clock * 1000).toLocaleString([], {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
          })
        ),
        datasets: [
          {
            label: items[0]?.name || "Sent",
            data: sentData.map((d) => Number(d.value) / divisor),
            borderColor: "rgba(68, 170, 170, 1)",
            backgroundColor: "rgba(16, 43, 43, 0.2)",
            tension: 0.3,
            fill: false,
          },
          {
            label: items[1]?.name || "Received",
            data: recvData.map((d) => Number(d.value) / divisor),
            borderColor: "rgba(255, 99, 132, 1)",
            backgroundColor: "rgba(255, 99, 132, 0.2)",
            tension: 0.3,
            fill: false,
          },
        ],
      });
    } finally {
      setLoading(false); // done loading
    }
  };
  useEffect(() => {
    fetchHistory();
  }, [itemids, range]);

  // Fetch monthly 95th percentile report
  const fetchMonthlyReport = async () => {
    if (!selectedMonth || !itemids || itemids.length < 2) return;

    setMonthlyLoading(true);
    try {
      const auth = localStorage.getItem("zabbixAuth");
      const [year, month] = selectedMonth.split("-").map(Number);
      
      // Get start and end of selected month
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59); // Last day of month
      
      const time_from = Math.floor(startDate.getTime() / 1000);
      const time_till = Math.floor(endDate.getTime() / 1000);

      const history = await axios.post(
        "https://monitoring.liquidtelecom.net/api_jsonrpc.php",
        {
          jsonrpc: "2.0",
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
        },
        { headers: { "Content-Type": "application/json" } }
      );

      const result = history.data.result;

      if (!result || result.length === 0) {
        setMonthlyStats({ error: "No data available for selected month" });
        return;
      }

      // Split by itemids
      const sentData = result.filter((d) => d.itemid === itemids[0]);
      const recvData = result.filter((d) => d.itemid === itemids[1]);

      // Calculate 95th percentile
      const calcP95 = (data) => {
        if (!data.length) return { p95: 0, max: 0, min: 0, avg: 0, samples: 0 };
        const values = data.map((d) => Number(d.value));
        const sorted = [...values].sort((a, b) => a - b);
        const p95Index = Math.ceil(0.95 * sorted.length) - 1;
        return {
          p95: sorted[p95Index] || 0,
          max: Math.max(...values),
          min: Math.min(...values),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          samples: values.length,
        };
      };

      const sentStats = calcP95(sentData);
      const recvStats = calcP95(recvData);

      // Determine display unit based on max value
      const maxValue = Math.max(sentStats.max, recvStats.max);
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

      setMonthlyUnit(displayUnit);
      setMonthlyStats({
        month: availableMonths.find((m) => m.value === selectedMonth)?.label,
        sent: {
          p95: sentStats.p95 / divisor,
          max: sentStats.max / divisor,
          min: sentStats.min / divisor,
          avg: sentStats.avg / divisor,
          samples: sentStats.samples,
        },
        recv: {
          p95: recvStats.p95 / divisor,
          max: recvStats.max / divisor,
          min: recvStats.min / divisor,
          avg: recvStats.avg / divisor,
          samples: recvStats.samples,
        },
        billingP95: Math.max(sentStats.p95, recvStats.p95) / divisor, // Common billing method
      });
    } catch (err) {
      console.error("Error fetching monthly report:", err);
      setMonthlyStats({ error: "Failed to fetch monthly data" });
    } finally {
      setMonthlyLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">
        Traffic Graph – {customer?.customerName} || Capacity{" "}
        {customer?.downmbps}Mbps
      </h1>

      <div className="mb-4">
        <select
          className="border px-3 py-2 rounded text-black"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="1h">Last 1 Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="12h">Last 12 Hours</option>
          <option value="24h">Last 1 Day</option>
          <option value="168h">Last 7 Days</option>
          <option value="720h">Last 30 Days</option>
        </select>
      </div>

      {loading ? (
        <p className="text-white">Loading graph...</p>
      ) : !graphData?.labels ? (
        <p>No graph data</p>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: "800px" }}>
            <Line
              data={graphData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  title: { display: true, text: `Traffic (${unit})` },
                  zoom: {
                    pan: { enabled: true, mode: "x", modifierKey: "ctrl" },
                    zoom: {
                      wheel: { enabled: true },
                      pinch: { enabled: true },
                      mode: "x",
                    },
                  },
                },
                interaction: { intersect: false, mode: "index" },
                scales: {
                  x: {
                    title: { display: true, text: "Time", color: "white" },
                    ticks: {
                      autoSkip: true, // reduces number of labels
                      maxRotation: 90,
                      minRotation: 90, // vertical labels
                      maxTicksLimit: 32, // limit the number of labels shown
                      color: "white",
                    },
                    grid: { color: "gray" }, // white vertical grid lines
                  },
                  y: {
                    title: { display: true, text: unit, color: "white" },
                    ticks: { color: "white" },
                    beginAtZero: true,
                    grid: { color: "gray" }, // white horizontal grid lines
                  },
                },
              }}
              height={450}
            />
          </div>
          <div className="text-sm space-y-4 border-t border-gray-600 pt-4">
            <h2 className="font-bold mb-1">Summary</h2>

            <div className="flex gap-10">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-block w-3 h-3 rounded"
                    style={{
                      backgroundColor: graphData?.datasets?.[0]?.borderColor,
                    }}
                  ></span>
                  <h3 className="font-semibold">{items[0]?.name || "Sent"}</h3>
                </div>
                <p>
                  Max: {stats.sent?.max?.toFixed(2)} {unit}
                </p>
                <p>
                  Min: {stats.sent?.min?.toFixed(2)} {unit}
                </p>
                <p>
                  Avg: {stats.sent?.avg?.toFixed(2)} {unit}
                </p>
                <p className="text-cyan-400 font-semibold">
                  95th %ile: {stats.sent?.p95?.toFixed(2)} {unit}
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-block w-3 h-3 rounded"
                    style={{
                      backgroundColor: graphData?.datasets?.[1]?.borderColor,
                    }}
                  ></span>
                  <h3 className="font-semibold">
                    {items[1]?.name || "Received"}
                  </h3>
                </div>
                <p>
                  Max: {stats.recv?.max?.toFixed(2)} {unit}
                </p>
                <p>
                  Min: {stats.recv?.min?.toFixed(2)} {unit}
                </p>
                <p>
                  Avg: {stats.recv?.avg?.toFixed(2)} {unit}
                </p>
                <p className="text-pink-400 font-semibold">
                  95th %ile: {stats.recv?.p95?.toFixed(2)} {unit}
                </p>
              </div>
            </div>
          </div>

          {/* Monthly 95th Percentile Report Section */}
          <div className="border-t border-gray-600 pt-6 mt-6">
            <h2 className="text-lg font-bold mb-4 text-yellow-400">
              📊 Monthly 95th Percentile Report
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              Select a month to generate the 95th percentile bandwidth usage report (commonly used for billing).
            </p>
            
            <div className="flex gap-4 items-center mb-4">
              <select
                className="border px-4 py-2 rounded text-black font-medium"
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                  setMonthlyStats(null);
                }}
              >
                <option value="">Select Month</option>
                {availableMonths.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={fetchMonthlyReport}
                disabled={!selectedMonth || monthlyLoading}
              >
                {monthlyLoading ? "Generating..." : "Generate Report"}
              </button>
            </div>

            {/* Monthly Report Results */}
            {monthlyStats && !monthlyStats.error && (
              <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-white">
                    {monthlyStats.month} - 95th Percentile Report
                  </h3>
                  <span className="text-sm text-gray-400">
                    Customer: {customer?.customerName}
                  </span>
                </div>

                {/* Billing 95th Percentile (Highlighted) */}
                <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-lg p-4 mb-6 border border-yellow-500/50">
                  <div className="text-center">
                    <p className="text-sm text-yellow-300 mb-1">Billing 95th Percentile (Higher of In/Out)</p>
                    <p className="text-4xl font-bold text-yellow-400">
                      {monthlyStats.billingP95?.toFixed(2)} <span className="text-xl">{monthlyUnit}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      Capacity: {customer?.downmbps} Mbps
                    </p>
                  </div>
                </div>

                {/* Detailed Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Outbound (Sent) Stats */}
                  <div className="bg-gray-900/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-3 h-3 rounded bg-cyan-500"></span>
                      <h4 className="font-semibold text-cyan-400">{items[0]?.name || "Outbound (Sent)"}</h4>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">95th Percentile:</span>
                        <span className="font-bold text-cyan-300">{monthlyStats.sent?.p95?.toFixed(2)} {monthlyUnit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Maximum:</span>
                        <span>{monthlyStats.sent?.max?.toFixed(2)} {monthlyUnit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Average:</span>
                        <span>{monthlyStats.sent?.avg?.toFixed(2)} {monthlyUnit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Minimum:</span>
                        <span>{monthlyStats.sent?.min?.toFixed(2)} {monthlyUnit}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                        <span className="text-gray-400">Data Points:</span>
                        <span className="text-xs">{monthlyStats.sent?.samples?.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Inbound (Received) Stats */}
                  <div className="bg-gray-900/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-3 h-3 rounded bg-pink-500"></span>
                      <h4 className="font-semibold text-pink-400">{items[1]?.name || "Inbound (Received)"}</h4>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">95th Percentile:</span>
                        <span className="font-bold text-pink-300">{monthlyStats.recv?.p95?.toFixed(2)} {monthlyUnit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Maximum:</span>
                        <span>{monthlyStats.recv?.max?.toFixed(2)} {monthlyUnit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Average:</span>
                        <span>{monthlyStats.recv?.avg?.toFixed(2)} {monthlyUnit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Minimum:</span>
                        <span>{monthlyStats.recv?.min?.toFixed(2)} {monthlyUnit}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                        <span className="text-gray-400">Data Points:</span>
                        <span className="text-xs">{monthlyStats.recv?.samples?.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Export Button */}
                <div className="mt-6 flex justify-end">
                  <button
                    className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm flex items-center gap-2"
                    onClick={() => {
                      const reportData = {
                        customer: customer?.customerName,
                        cid: customer?.cid,
                        capacity: customer?.downmbps,
                        month: monthlyStats.month,
                        billingP95: `${monthlyStats.billingP95?.toFixed(2)} ${monthlyUnit}`,
                        outbound: `${monthlyStats.sent?.p95?.toFixed(2)} ${monthlyUnit}`,
                        inbound: `${monthlyStats.recv?.p95?.toFixed(2)} ${monthlyUnit}`,
                      };
                      const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `95th-percentile-${customer?.customerName}-${selectedMonth}.json`;
                      a.click();
                    }}
                  >
                    📥 Export Report
                  </button>
                </div>
              </div>
            )}

            {monthlyStats?.error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-300">
                {monthlyStats.error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewGraph;
