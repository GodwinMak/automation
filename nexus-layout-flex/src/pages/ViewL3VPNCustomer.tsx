import React, { useEffect, useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { PRODUCTION_URL } from "@/utils/Api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuthContext } from "@/hooks/useAuthContext";
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

  // Upgrade/downgrade state
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isTempEditModalOpen, setIsTempEditModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const [upgradeError, setUpgradeError] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const { state: authState } = useAuthContext();
  const [upgradeFormData, setUpgradeFormData] = useState({
    new_upmbps: "",
    new_downmbps: "",
    type: "temporary",
    duration: "1m",
    approved_by: "",
    account_manager: "",
    upgrade_type: "upgrade",
  });
  const [tempEditForm, setTempEditForm] = useState({
    type: "temporary",
    expiryMode: "duration",
    duration: "1d",
    expires_at: "",
    new_upmbps: "",
    new_downmbps: "",
    password: "",
  });

  const formatRemainingTime = (expiresAt: string | undefined) => {
    if (!expiresAt) return "No expiry";

    const now = new Date();
    const expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime())) return "Invalid expiry";

    const diffMs = expiry.getTime() - now.getTime();
    if (diffMs <= 0) return "Expired";

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const openUpgradeFlow = () => {
    setSelectedCustomer(customer);
    setIsPasswordModalOpen(true);
  };

  const handleUpgradePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      alert("Password is required.");
      return;
    }
    setIsPasswordModalOpen(false);
    setIsUpgradeModalOpen(true);
  };

  const handleUpgradeFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setUpgradeFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleUpgradeTypeFieldChange = (value: string) => {
    setUpgradeFormData((prev) => ({ ...prev, type: value }));
  };

  const handleUpgradeActionChange = (value: string) => {
    setUpgradeFormData((prev) => ({ ...prev, upgrade_type: value }));
  };

  const openTemporaryEditFlow = () => {
    setTempEditForm({
      type: "temporary",
      expiryMode: "duration",
      duration: "1d",
      expires_at: customer?.expires_at
        ? new Date(customer.expires_at).toISOString().slice(0, 16)
        : "",
      new_upmbps: customer?.upmbps != null ? String(customer.upmbps) : "",
      new_downmbps: customer?.downmbps != null ? String(customer.downmbps) : "",
      password: "",
    });
    setIsTempEditModalOpen(true);
  };

  const handleTemporaryEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpgradeLoading(true);
    setUpgradeMessage("");
    setUpgradeError("");

    const username = authState?.userData?.username;
    if (!username) {
      setUpgradeError("Authentication failed: Username not found.");
      setUpgradeLoading(false);
      return;
    }

    const nextUp = Number(tempEditForm.new_upmbps);
    const nextDown = Number(tempEditForm.new_downmbps);
    if (!Number.isFinite(nextUp) || !Number.isFinite(nextDown) || nextUp <= 0 || nextDown <= 0) {
      setUpgradeError("Capacity must be positive numbers.");
      setUpgradeLoading(false);
      return;
    }

    const payload: any = {
      interface: customer?.interface,
      type: tempEditForm.type,
      new_upmbps: nextUp,
      new_downmbps: nextDown,
    };

    if (tempEditForm.type === "temporary") {
      if (tempEditForm.expiryMode === "duration") {
        if (!tempEditForm.duration?.trim()) {
          setUpgradeError("Duration is required.");
          setUpgradeLoading(false);
          return;
        }
        payload.duration = tempEditForm.duration.trim();
      } else {
        if (!tempEditForm.expires_at) {
          setUpgradeError("End date is required.");
          setUpgradeLoading(false);
          return;
        }
        payload.expires_at = new Date(tempEditForm.expires_at).toISOString();
      }
    }

    const isCapacityChanged =
      nextUp !== Number(customer?.upmbps || 0) || nextDown !== Number(customer?.downmbps || 0);
    if (isCapacityChanged) {
      if (!tempEditForm.password) {
        setUpgradeError("Password is required when changing capacity.");
        setUpgradeLoading(false);
        return;
      }
      payload.username = username;
      payload.password = tempEditForm.password;
    }

    try {
      const response = await axios.put(`${PRODUCTION_URL}/upgrade/l3vpn/temporary/edit`, payload);
      setUpgradeMessage(response.data?.message || "Temporary upgrade updated successfully.");
      setCustomer((prev: any) => ({ ...prev, ...response.data?.customer }));
      setIsTempEditModalOpen(false);
      setUpgradeLoading(false);
    } catch (err: any) {
      console.error("Temporary edit error:", err);
      setUpgradeError(err.response?.data?.message || "Failed to update temporary upgrade.");
      setUpgradeLoading(false);
    }
  };

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpgradeLoading(true);
    setUpgradeMessage("");
    setUpgradeError("");

    const username = authState?.userData?.username;

    if (!username) {
      setUpgradeError("Authentication failed: Username not found.");
      setUpgradeLoading(false);
      return;
    }

    const payload = {
      interface: selectedCustomer.interface,
      new_upmbps: Number(upgradeFormData.new_upmbps),
      new_downmbps: Number(upgradeFormData.new_downmbps),
      type: upgradeFormData.type,
      duration: upgradeFormData.type === "temporary" ? upgradeFormData.duration : null,
      username,
      password,
      approved_by: upgradeFormData.approved_by,
      account_manager: upgradeFormData.account_manager,
      upgrade_type: upgradeFormData.upgrade_type,
    };

    try {
      const response = await axios.post(`${PRODUCTION_URL}/upgrade/l3vpn`, payload);
      setUpgradeMessage(response.data.message || "Upgrade successful.");
      setTimeout(() => {
        setIsUpgradeModalOpen(false);
        setPassword("");
        setUpgradeLoading(false);
      }, 2000);
    } catch (err: any) {
      console.error("Upgrade error:", err);
      setUpgradeError(
        err.response?.data?.message || "An error occurred during the upgrade."
      );
      setUpgradeLoading(false);
    }
  };

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
    { label: "Upload (Mbps)", value: customer.upmbps ?? "-" },
    { label: "Download (Mbps)", value: customer.downmbps ?? "-" },
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
              size="sm"
              onClick={openUpgradeFlow}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              Upgrade/Downgrade
            </Button>
            {customer?.upgrade_type === "temporary" && (
              <Button
                size="sm"
                onClick={openTemporaryEditFlow}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              >
                Edit Temporary
              </Button>
            )}
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

      {customer?.upgrade_type === "temporary" && (
        <div className="container mx-auto px-6 pt-4">
          <p className="text-amber-600 font-medium">
            Temporary Upgrade Remaining: {formatRemainingTime(customer?.expires_at)}
          </p>
        </div>
      )}

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

      <Dialog open={isTempEditModalOpen} onOpenChange={setIsTempEditModalOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Edit Temporary Upgrade</DialogTitle>
            <DialogDescription>
              Change temporary end date, capacity, or convert this customer to permanent.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTemporaryEdit} className="grid gap-4 py-2">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Type</Label>
              <div className="col-span-3">
                <Select
                  value={tempEditForm.type}
                  onValueChange={(value) => setTempEditForm((prev) => ({ ...prev, type: value }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="temporary">Temporary</SelectItem>
                    <SelectItem value="permanent">Permanent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">New Up</Label>
              <Input
                className="col-span-3"
                type="number"
                min="1"
                value={tempEditForm.new_upmbps}
                onChange={(e) => setTempEditForm((prev) => ({ ...prev, new_upmbps: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">New Down</Label>
              <Input
                className="col-span-3"
                type="number"
                min="1"
                value={tempEditForm.new_downmbps}
                onChange={(e) => setTempEditForm((prev) => ({ ...prev, new_downmbps: e.target.value }))}
              />
            </div>

            {tempEditForm.type === "temporary" && (
              <>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">End Mode</Label>
                  <div className="col-span-3">
                    <Select
                      value={tempEditForm.expiryMode}
                      onValueChange={(value) => setTempEditForm((prev) => ({ ...prev, expiryMode: value }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="duration">Duration</SelectItem>
                        <SelectItem value="date">Date/Time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {tempEditForm.expiryMode === "duration" ? (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Duration</Label>
                    <Input
                      className="col-span-3"
                      value={tempEditForm.duration}
                      onChange={(e) => setTempEditForm((prev) => ({ ...prev, duration: e.target.value }))}
                      placeholder="e.g., 12h, 3d"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">End Date</Label>
                    <Input
                      className="col-span-3"
                      type="datetime-local"
                      value={tempEditForm.expires_at}
                      onChange={(e) => setTempEditForm((prev) => ({ ...prev, expires_at: e.target.value }))}
                    />
                  </div>
                )}
              </>
            )}

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Password</Label>
              <Input
                className="col-span-3"
                type="password"
                value={tempEditForm.password}
                onChange={(e) => setTempEditForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Required only if capacity changed"
              />
            </div>

            {upgradeMessage && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 text-green-600 py-3 px-4">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="font-medium">{upgradeMessage}</span>
              </div>
            )}
            {upgradeError && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 py-3 px-4">
                <XCircle className="h-5 w-5 shrink-0" />
                <span className="font-medium">{upgradeError}</span>
              </div>
            )}

            <DialogFooter>
              <Button type="submit" disabled={upgradeLoading}>
                {upgradeLoading ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* === Password Modal === */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Password for SSH</DialogTitle>
            <DialogDescription>
              Please enter your SSH password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpgradePasswordSubmit}>
            <div className="py-4">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit">Continue</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* === Upgrade/Downgrade Modal === */}
      <Dialog open={isUpgradeModalOpen} onOpenChange={setIsUpgradeModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upgrade / Downgrade Customer</DialogTitle>
            <DialogDescription>
              Adjust bandwidth and provide approval details.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpgrade} className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="interface" className="text-right">
                Interface
              </Label>
              <Input
                id="interface"
                value={selectedCustomer?.interface || ""}
                disabled
                className="col-span-3"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Action</Label>
              <RadioGroup
                value={upgradeFormData.upgrade_type}
                onValueChange={handleUpgradeActionChange}
                className="col-span-3 flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="upgrade" id="upgrade" />
                  <Label htmlFor="upgrade">Upgrade</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="downgrade" id="downgrade" />
                  <Label htmlFor="downgrade">Downgrade</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new_upmbps" className="text-right">
                New Up (Mbps)
              </Label>
              <Input
                id="new_upmbps"
                name="new_upmbps"
                type="number"
                value={upgradeFormData.new_upmbps}
                onChange={handleUpgradeFormChange}
                required
                className="col-span-3"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new_downmbps" className="text-right">
                New Down (Mbps)
              </Label>
              <Input
                id="new_downmbps"
                name="new_downmbps"
                type="number"
                value={upgradeFormData.new_downmbps}
                onChange={handleUpgradeFormChange}
                required
                className="col-span-3"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Type</Label>
              <RadioGroup
                value={upgradeFormData.type}
                onValueChange={handleUpgradeTypeFieldChange}
                className="col-span-3 flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="permanent" id="permanent" />
                  <Label htmlFor="permanent">Permanent</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="temporary" id="temporary" />
                  <Label htmlFor="temporary">Temporary</Label>
                </div>
              </RadioGroup>
            </div>

            {upgradeFormData.type === "temporary" && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="duration" className="text-right">
                  Duration
                </Label>
                <Input
                  id="duration"
                  name="duration"
                  value={upgradeFormData.duration}
                  onChange={handleUpgradeFormChange}
                  placeholder="e.g., 1m, 1h, 1d"
                  className="col-span-3"
                />
              </div>
            )}

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="approved_by" className="text-right">
                Approved By
              </Label>
              <Input
                id="approved_by"
                name="approved_by"
                value={upgradeFormData.approved_by}
                onChange={handleUpgradeFormChange}
                placeholder="Name of approver"
                required
                className="col-span-3"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="account_manager" className="text-right">
                Account Manager
              </Label>
              <Input
                id="account_manager"
                name="account_manager"
                value={upgradeFormData.account_manager}
                onChange={handleUpgradeFormChange}
                placeholder="Name of account manager"
                required
                className="col-span-3"
              />
            </div>

            {upgradeMessage && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 text-green-600 py-3 px-4">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="font-medium">{upgradeMessage}</span>
              </div>
            )}
            {upgradeError && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 py-3 px-4">
                <XCircle className="h-5 w-5 shrink-0" />
                <span className="font-medium">{upgradeError}</span>
              </div>
            )}

            <DialogFooter className="mt-4">
              <Button type="submit" disabled={upgradeLoading}>
                {upgradeLoading ? "Processing..." : "Submit"}
              </Button>
            </DialogFooter>
          </form>
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
