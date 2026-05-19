import React, { useEffect, useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { PRODUCTION_URL } from "@/utils/Api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Network,
  Server,
  Layers,
  BarChart2,
  Stethoscope,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Route,
} from "lucide-react";
import { Line } from "react-chartjs-2";
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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title);

const ViewL3VPNCustomer = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { state: customerInfo } = location;

  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(false);

  // Diagnosis state
  const [isDiagnosisModalOpen, setIsDiagnosisModalOpen] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<any>(null);
  const [diagnosisError, setDiagnosisError] = useState("");

  const handleDiagnosis = async () => {
    setDiagnosisResult(null);
    setDiagnosisError("");
    setDiagnosisLoading(true);
    setIsDiagnosisModalOpen(true);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/diagnosis/l3vpn`, {
        interfaceName: customer?.interface,
      });
      setDiagnosisResult(res.data);
      console.log(res.data);
    } catch (err: any) {
      setDiagnosisError(
        err.response?.data?.message || err.message || "Diagnosis failed."
      );
    } finally {
      setDiagnosisLoading(false);
    }
  };

  // Map switch names to Zabbix host names
  const getZabbixHostName = (switchName: string) => {
    const hostMapping: Record<string, string> = {
      "LTZ-PE1-RAH": "lo-0.ltz-pe1-rah.liquidtelecom.net",
    };
    return hostMapping[switchName] || switchName;
  };

  const handleFetchGraph = async () => {
    try {
      setGraphLoading(true);
      const auth = localStorage.getItem("zabbixAuth");
      const switchName = customer?.l3vpncustomer?.switchName;
      const zabbixHostName = getZabbixHostName(switchName);

      const host = await zabbixApi({
        method: "host.get",
        params: { output: ["hostid"], filter: { host: [zabbixHostName] } },
        id: 1,
        auth,
      });

      console.log(host);
      const hostid =
        Array.isArray(host) && host.length > 0 ? host[0].hostid : undefined;
      if (!hostid) throw new Error("Host ID not found");

      const graph = await zabbixApi({
        method: "graph.get",
        params: {
          hostids: [hostid],
          search: { name: customer?.interface },
          output: "extend",
          selectItems: "extend",
        },
        id: 1,
        auth,
      });
      if (!graph.length) throw new Error("Graph not found");

      const itemids = graph[0].items.map((i: any) => ({
        itemid: i.itemid,
        name: i.name,
      }));
      localStorage.setItem("zabbix_itemids", JSON.stringify(itemids));

      navigate("/view-graph", {
        state: { customer: customer, itemids, type: "l3vpn" },
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message);
      setGraphLoading(false);
    }
  };

  useEffect(() => {
    const fetchCustomer = async () => {
      if (customerInfo?.customer?.id) {
        try {
          const res = await axios.get(
            `${PRODUCTION_URL}/l3vpncustomers/${customerInfo.customer.id}`,
          );
          setCustomer(res.data);
        } catch (err) {
          console.error("Error fetching L3VPN customer:", err);
          setCustomer(customerInfo.customer);
        }
      } else {
        setCustomer(customerInfo?.customer);
      }
      setLoading(false);
    };
    fetchCustomer();
  }, [customerInfo]);

  if (loading || !customer) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading customer details...</p>
        </div>
      </div>
    );
  }

  const operationalStatus =
    customer?.l3vpncustomer?.operationalStatus ?? "unknown";
  const isUp = operationalStatus === "up";

  const infoRows = [
    { label: "Customer Name", value: customer.customerName },
    { label: "Interface", value: customer.interface },
    { label: "Neighbor (NBR)", value: customer.nbr || "-" },
    { label: "Port", value: customer.port || "-" },
    { label: "Circuit ID", value: customer.cid || "-" },
    { label: "PE / Switch", value: customer?.l3vpncustomer?.switchName || "-" },
    {
      label: "Destination",
      value: customer?.l3vpncustomer?.destination || "-",
    },
    {
      label: "Description",
      value: customer?.l3vpncustomer?.description || "-",
    },
    { label: "Admin Status", value: customer?.l3vpncustomer?.adminStatus || "-" },
    { label: "Route Instance", value: customer.route_instance || "-" },
  ];

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {customer.customerName || "L3VPN Customer"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {customer.interface}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiagnosis}
              disabled={diagnosisLoading}
              className="gap-2"
            >
              <Stethoscope className="h-4 w-4" />
              Diagnose
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFetchGraph}
              disabled={graphLoading}
              className="gap-2"
            >
              <BarChart2 className="h-4 w-4" />
              {graphLoading ? "Loading..." : "View Graph"}
            </Button>
            <Badge
              variant={isUp ? "default" : "destructive"}
              className={`text-sm px-3 py-1 ${isUp ? "bg-success text-white" : ""}`}
            >
              {operationalStatus.toUpperCase()}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-6 py-8 space-y-6">
        {/* Customer Info Card */}
        <Card className="border border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Network className="h-5 w-5 text-primary" />
              Customer Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {infoRows.map(({ label, value }) => (
                <div
                  key={label}
                  className="p-4 rounded-xl bg-muted/50 border border-border"
                >
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className="font-medium text-foreground break-all">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Status Card */}
        <Card className="border border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Server className="h-5 w-5 text-primary" />
              Link Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div
                className={`p-4 rounded-xl border ${isUp ? "border-success/20 bg-success/10" : "border-destructive/20 bg-destructive/10"}`}
              >
                <p className="text-xs text-muted-foreground mb-1">
                  Operational Status
                </p>
                <p
                  className={`text-xl font-bold ${isUp ? "text-success" : "text-destructive"}`}
                >
                  {operationalStatus.toUpperCase()}
                </p>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">
                  Admin Status
                </p>
                <p className="text-xl font-bold text-foreground">
                  {(customer?.l3vpncustomer?.adminStatus ?? "-").toUpperCase()}
                </p>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">PE Node</p>
                <p className="text-xl font-bold text-foreground">
                  {customer?.l3vpncustomer?.switchName || "-"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* === Diagnosis Modal === */}
      <Dialog open={isDiagnosisModalOpen} onOpenChange={setIsDiagnosisModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto dark:text-white">
          <DialogHeader>
            <DialogTitle>L3VPN Diagnosis — {customer?.interface}</DialogTitle>
          </DialogHeader>

          {diagnosisLoading ? (
            <div className="text-center py-8">Diagnosing... Please wait.</div>
          ) : diagnosisError ? (
            <div className="text-red-600 text-center py-4">{diagnosisError}</div>
          ) : diagnosisResult ? (
            <div className="space-y-4 py-2">
              {diagnosisResult.message && (
                <div className="font-semibold text-lg mb-2 text-primary dark:text-white">{diagnosisResult.message}</div>
              )}

              {/* Route Instance */}
              {diagnosisResult.routeInstance && (
                <div className="bg-green-50 dark:bg-green-900 rounded-lg p-3 flex items-center gap-2 text-sm">
                  <Route className="h-4 w-4 text-green-600 dark:text-green-300 shrink-0" />
                  <span className="font-semibold">Route Instance:</span>
                  <span>{diagnosisResult.routeInstance}</span>
                </div>
              )}

              {/* Ping Results */}
              {(diagnosisResult.pingResult || (diagnosisResult.pingResults && Array.isArray(diagnosisResult.pingResults))) && (
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 mb-2">
                  <h3 className="font-bold text-indigo-700 dark:text-indigo-300 mb-2">Latency & Ping Results</h3>
                  {diagnosisResult.pingResult && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="font-semibold">IP:</span> {diagnosisResult.pingResult.ip}</div>
                      <div><span className="font-semibold">Packet Loss:</span> {diagnosisResult.pingResult.packetLoss}%</div>
                      <div><span className="font-semibold">Avg Latency:</span> {diagnosisResult.pingResult.avgLatency} ms</div>
                      <div><span className="font-semibold">Min Latency:</span> {diagnosisResult.pingResult.minLatency} ms</div>
                      <div><span className="font-semibold">Max Latency:</span> {diagnosisResult.pingResult.maxLatency} ms</div>
                      <div><span className="font-semibold">Stddev:</span> {diagnosisResult.pingResult.stddevLatency} ms</div>
                    </div>
                  )}
                  {diagnosisResult.pingResults && Array.isArray(diagnosisResult.pingResults) && (
                    <div className="mt-2">
                      {diagnosisResult.pingResults.map((pr: any, idx: number) => (
                        <div
                          key={idx}
                          className={`rounded-lg p-3 shadow border text-xs mb-2 ${
                            pr.packetLoss > 0
                              ? "bg-red-50 dark:bg-red-900 border-red-200 dark:border-red-700"
                              : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                          }`}
                        >
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div><span className="font-semibold">IP:</span> {pr.ip}</div>
                            <div><span className="font-semibold">Packet Loss:</span> {pr.packetLoss}%</div>
                            <div><span className="font-semibold">Avg Latency:</span> {pr.avgLatency} ms</div>
                            <div><span className="font-semibold">Min Latency:</span> {pr.minLatency} ms</div>
                            <div><span className="font-semibold">Max Latency:</span> {pr.maxLatency} ms</div>
                            <div><span className="font-semibold">Stddev:</span> {pr.stddevLatency} ms</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Power Info */}
              {diagnosisResult.powerInfo && (
                <div className="bg-yellow-50 dark:bg-yellow-900 rounded-lg p-4 mb-2">
                  <h3 className="font-bold text-yellow-700 dark:text-yellow-200 mb-2">Optical Power Diagnostics</h3>
                  {Array.isArray(diagnosisResult.powerInfo) ? (
                    <table className="w-full text-xs border dark:border-yellow-800">
                      <thead>
                        <tr className="bg-yellow-100 dark:bg-yellow-800">
                          <th className="p-1 text-left">Label</th>
                          <th className="p-1 text-left">mW</th>
                          <th className="p-1 text-left">dBm</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnosisResult.powerInfo.map((p: any, idx: number) => (
                          <tr key={idx}>
                            <td className="p-1">{p.label}</td>
                            <td className="p-1">{p.mW}</td>
                            <td className="p-1">{p.dBm}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-sm">{diagnosisResult.powerInfo}</div>
                  )}
                </div>
              )}

              {/* Flap Info */}
              {diagnosisResult.flappedInfo && (
                <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-4 mb-2">
                  <h3 className="font-bold text-blue-700 dark:text-blue-200 mb-2">Flap Info</h3>
                  {typeof diagnosisResult.flappedInfo === "object" ? (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="font-semibold">Last Flapped:</span> {diagnosisResult.flappedInfo.lastFlapped}</div>
                      <div><span className="font-semibold">Ago:</span> {diagnosisResult.flappedInfo.durationAgo}</div>
                    </div>
                  ) : (
                    <div className="text-sm">{diagnosisResult.flappedInfo}</div>
                  )}
                </div>
              )}

              {/* Neighbor Switch & Media */}
              {(diagnosisResult.neighborSwitch || diagnosisResult.customerPort || diagnosisResult.mediaType) && (
                <div className="bg-purple-50 dark:bg-purple-900 rounded-lg p-4 mb-2">
                  <h3 className="font-bold text-purple-700 dark:text-purple-200 mb-2">Neighbor Switch Details</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {diagnosisResult.neighborSwitch && (
                      <>
                        <div><span className="font-semibold">Neighbor Name:</span> {diagnosisResult.neighborSwitch.name || "Unknown"}</div>
                        <div><span className="font-semibold">Neighbor IP:</span> {diagnosisResult.neighborSwitch.ip}</div>
                      </>
                    )}
                    {diagnosisResult.customerPort && (
                      <div><span className="font-semibold">Customer Port:</span> {diagnosisResult.customerPort}</div>
                    )}
                    {diagnosisResult.mediaType && (
                      <div><span className="font-semibold">Media Type:</span> {diagnosisResult.mediaType}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Traffic Graph */}
              {diagnosisResult.graphData?.sentData && diagnosisResult.graphData?.recvData && (() => {
                const sentVals = diagnosisResult.graphData.sentData.map((d: any) => Number(d.value));
                const recvVals = diagnosisResult.graphData.recvData.map((d: any) => Number(d.value));
                const allVals = [...sentVals, ...recvVals];
                const maxValue = Math.max(...allVals);
                let displayUnit = "bps", divisor = 1;
                if (maxValue > 1_000_000_000) { displayUnit = "Gbps"; divisor = 1_000_000_000; }
                else if (maxValue > 1_000_000) { displayUnit = "Mbps"; divisor = 1_000_000; }
                else if (maxValue > 1_000) { displayUnit = "Kbps"; divisor = 1_000; }

                const calcP95 = (data: any[]) => {
                  if (!data?.length) return { p95: 0, max: 0, min: 0, avg: 0, samples: 0 };
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

                const sentStats = calcP95(diagnosisResult.graphData.sentData);
                const recvStats = calcP95(diagnosisResult.graphData.recvData);
                const upMbps = customer?.upmbps;
                const downMbps = customer?.downmbps;
                const upCapacityBps = typeof upMbps === "number" ? upMbps * 1_000_000 : null;
                const downCapacityBps = typeof downMbps === "number" ? downMbps * 1_000_000 : null;
                const uploadPctOfCap = upCapacityBps ? (sentStats.max / upCapacityBps) * 100 : null;
                const downloadPctOfCap = downCapacityBps ? (recvStats.max / downCapacityBps) * 100 : null;
                const capacityStatus = (pct: number | null) => {
                  if (pct == null || Number.isNaN(pct)) return "Unknown";
                  if (pct >= 95) return "Maxed";
                  if (pct >= 85) return "Near max";
                  return "Not maxed";
                };
                const isDark = document.documentElement.classList.contains("dark");
                const labelColor = isDark ? "#fff" : "#000";

                return (
                  <div className="bg-white dark:bg-gray-900 rounded-lg p-4 mb-2">
                    <h3 className="font-bold text-green-700 dark:text-green-300 mb-2">Traffic Graph (Last 6 Hours)</h3>
                    <div style={{ minWidth: "600px" }}>
                      <Line
                        data={{
                          labels: diagnosisResult.graphData.sentData.map((d: any) =>
                            new Date(d.clock * 1000).toLocaleTimeString()
                          ),
                          datasets: [
                            {
                              label: "Sent",
                              data: sentVals.map((v: number) => v / divisor),
                              borderColor: "rgba(68, 170, 170, 1)",
                              backgroundColor: "rgba(16, 43, 43, 0.2)",
                              tension: 0.3,
                              fill: false,
                            },
                            {
                              label: "Received",
                              data: recvVals.map((v: number) => v / divisor),
                              borderColor: "rgba(255, 99, 132, 1)",
                              backgroundColor: "rgba(255, 99, 132, 0.2)",
                              tension: 0.3,
                              fill: false,
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: { display: true, labels: { color: labelColor, font: { weight: "bold" } } },
                            title: { display: true, text: `Traffic (${displayUnit})`, color: labelColor },
                          },
                          interaction: { intersect: false, mode: "index" },
                          scales: {
                            x: {
                              title: { display: true, text: "Time", color: labelColor },
                              ticks: { autoSkip: true, maxRotation: 90, minRotation: 90, maxTicksLimit: 32, color: labelColor },
                              grid: { color: "gray" },
                            },
                            y: {
                              title: { display: true, text: displayUnit, color: labelColor },
                              ticks: { color: labelColor },
                              beginAtZero: true,
                              grid: { color: "gray" },
                            },
                          },
                        }}
                        height={350}
                      />
                    </div>
                    <div className="mt-4 text-xs md:text-sm text-foreground dark:text-gray-200">
                      <h4 className="font-semibold mb-1">Usage Summary (95th Percentile)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <div className="font-semibold">Sent</div>
                          <div>P95: {(sentStats.p95 / divisor).toFixed(2)} {displayUnit}</div>
                          <div>Max: {(sentStats.max / divisor).toFixed(2)} {displayUnit}</div>
                          <div>Avg: {(sentStats.avg / divisor).toFixed(2)} {displayUnit}</div>
                          <div>Samples: {sentStats.samples}</div>
                        </div>
                        <div>
                          <div className="font-semibold">Received</div>
                          <div>P95: {(recvStats.p95 / divisor).toFixed(2)} {displayUnit}</div>
                          <div>Max: {(recvStats.max / divisor).toFixed(2)} {displayUnit}</div>
                          <div>Avg: {(recvStats.avg / divisor).toFixed(2)} {displayUnit}</div>
                          <div>Samples: {recvStats.samples}</div>
                        </div>
                      </div>
                      {(upCapacityBps || downCapacityBps) && (
                        <div className="mt-3">
                          <h4 className="font-semibold mb-1">Capacity Check</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {upCapacityBps && (
                              <div>
                                <span className="font-semibold">Upload:</span>{" "}
                                {capacityStatus(uploadPctOfCap)}
                                {uploadPctOfCap != null && !Number.isNaN(uploadPctOfCap) && (
                                  <span> ({uploadPctOfCap.toFixed(1)}% of {upMbps} Mbps)</span>
                                )}
                              </div>
                            )}
                            {downCapacityBps && (
                              <div>
                                <span className="font-semibold">Download:</span>{" "}
                                {capacityStatus(downloadPctOfCap)}
                                {downloadPctOfCap != null && !Number.isNaN(downloadPctOfCap) && (
                                  <span> ({downloadPctOfCap.toFixed(1)}% of {downMbps} Mbps)</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="text-center py-4">No diagnosis data.</div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsDiagnosisModalOpen(false)} type="button">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ViewL3VPNCustomer;

const zabbixApi = async (payload: any) => {
  const response = await fetch(
    "https://monitoring.liquidtelecom.net/api_jsonrpc.php",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", ...payload }),
    },
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error.data || data.error.message);
  return data.result;
};
