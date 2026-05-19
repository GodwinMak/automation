import React, { useState, useEffect } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Network } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthContext } from "@/hooks/useAuthContext";
import { useLocation } from "react-router-dom";
import { PRODUCTION_URL } from "@/utils/Api";
import { CustomerInfo } from "@/components/CustomerInfo";
import { FavoriteButton } from "@/components/FavoriteButton";
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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title
);
import { useNavigate } from "react-router-dom";
import CustomerMLAnalysis from "@/components/CustomerMLAnalysis";


const ViewDiaCutomer = () => {
  const navigate = useNavigate();

  // Diagnosis Modal State and Handler (must be inside component)
  const [isDiagnosisModalOpen, setIsDiagnosisModalOpen] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<any>(null);
  const [diagnosisError, setDiagnosisError] = useState("");

  // Uptime modal state
  const [isUptimeModalOpen, setIsUptimeModalOpen] = useState(false);
  const [uptimeStartDate, setUptimeStartDate] = useState("");
  const [uptimeLoading, setUptimeLoading] = useState(false);
  const [uptimeError, setUptimeError] = useState("");
  const [uptimeResult, setUptimeResult] = useState<any>(null);

  const formatDisplayDate = (isoString: string | undefined) => {
    if (!isoString) return "-";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString("en-GB"); // dd/mm/yyyy
  };

  const handleDiagnosis = async () => {
    setDiagnosisResult(null);
    setDiagnosisError("");
    setDiagnosisLoading(true);
    setIsDiagnosisModalOpen(true); // Open modal immediately so loading shows
    try {
      const res = await axios.post(`${PRODUCTION_URL}/diagnosis`, {
        interfaceName: customerData.interface,
      });
      setDiagnosisResult(res.data);
    } catch (err: any) {
      setDiagnosisError(
        err.response?.data?.message || err.message || "Diagnosis failed."
      );
    } finally {
      setDiagnosisLoading(false);
    }
  };

  const handleOpenUptimeModal = () => {
    // Default to 7 days ago, but enforce 90-day window via input attrs/backend
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const defaultDate = sevenDaysAgo.toISOString().split("T")[0]; // yyyy-mm-dd for native date input
    setUptimeStartDate(defaultDate);
    setUptimeResult(null);
    setUptimeError("");
    setIsUptimeModalOpen(true);
  };

  const handleCheckUptime = async () => {
    try {
      setUptimeError("");
      setUptimeResult(null);

      if (!uptimeStartDate) {
        setUptimeError("Please select a start date.");
        return;
      }

      let startDateObj: Date | null = null;

      // Support both manual dd/mm/yyyy and native yyyy-mm-dd
      if (uptimeStartDate.includes("/")) {
        const parts = uptimeStartDate.split("/");
        if (parts.length !== 3) {
          setUptimeError("Date must be in format dd/mm/yyyy.");
          return;
        }

        const [dayStr, monthStr, yearStr] = parts;
        const day = Number(dayStr);
        const month = Number(monthStr);
        const year = Number(yearStr);

        if (!day || !month || !year) {
          setUptimeError("Invalid date. Please use dd/mm/yyyy.");
          return;
        }

        startDateObj = new Date(year, month - 1, day);
      } else if (uptimeStartDate.includes("-")) {
        // Native date input value: yyyy-mm-dd
        const [yearStr, monthStr, dayStr] = uptimeStartDate.split("-");
        const year = Number(yearStr);
        const month = Number(monthStr);
        const day = Number(dayStr);

        if (!day || !month || !year) {
          setUptimeError("Invalid date selected.");
          return;
        }

        startDateObj = new Date(year, month - 1, day);
      }

      if (!startDateObj) {
        setUptimeError("Invalid date.");
        return;
      }
      if (isNaN(startDateObj.getTime())) {
        setUptimeError("Invalid date. Please use dd/mm/yyyy.");
        return;
      }

      const now = new Date();
      const diffMs = now.getTime() - startDateObj.getTime();
      const maxRangeMs = 90 * 24 * 60 * 60 * 1000;

      if (diffMs < 0) {
        setUptimeError("Start date cannot be in the future.");
        return;
      }

      if (diffMs > maxRangeMs) {
        setUptimeError("Range cannot exceed 90 days from today.");
        return;
      }

      // Backend expects ISO yyyy-mm-dd, but we must avoid timezone shifts
      // so we build the date string manually instead of using toISOString().
      let isoStartDate = "";
      if (uptimeStartDate.includes("/")) {
        // dd/mm/yyyy -> yyyy-mm-dd
        const [dayStr, monthStr, yearStr] = uptimeStartDate.split("/");
        isoStartDate = `${yearStr.padStart(4, "0")}-${monthStr.padStart(2, "0")}-${dayStr.padStart(2, "0")}`;
      } else {
        // Native date input already gives yyyy-mm-dd
        isoStartDate = uptimeStartDate;
      }

      setUptimeLoading(true);

      const res = await axios.post(`${PRODUCTION_URL}/diagnosis/uptime`, {
        interfaceName: customerData.interface,
        startDate: isoStartDate,
      });

      setUptimeResult(res.data);
    } catch (err: any) {
      setUptimeError(
        err?.response?.data?.message || err.message || "Failed to calculate uptime."
      );
    } finally {
      setUptimeLoading(false);
    }
  };

  const handleDownloadUptimePdf = () => {
    // Use browser print dialog; user can choose "Save as PDF"
    window.print();
  };
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [fetchingCustomer, setFetchingCustomer] = useState(false);
  const [customer, setCustomer] = useState<any>(null);

  const location = useLocation();
  const { state: customerInfo } = location;
  const { state: authState } = useAuthContext();

  // Detect if coming from Watchlist (flat data without nested diacustomer)
  const isFromWatchlist = customerInfo?.customer && !customerInfo?.customer?.diacustomer;
  const isFromOverusage = !!customerInfo?.fromOverusage && !!customerInfo?.interface;
  const isFromPitch = !!customerInfo?.fromPitch && !!customerInfo?.interface;



  // Fetch full customer data if coming from Watchlist, Over-Usage, or Pitch For Upgrade report
  useEffect(() => {
    const fetchFullCustomer = async () => {
      if (isFromWatchlist && customerInfo?.customer?.customerId) {
        setFetchingCustomer(true);
        try {
          const res = await axios.get(
            `${PRODUCTION_URL}/customers/${customerInfo.customer.customerId}`
          );
          setCustomer(res.data);
        } catch (err) {
          console.error("Error fetching customer:", err);
          // Fallback to the passed data
          setCustomer(customerInfo?.customer);
        } finally {
          setFetchingCustomer(false);
        }
      } else if ((isFromOverusage || isFromPitch) && customerInfo?.interface) {
        setFetchingCustomer(true);
        try {
          const res = await axios.get(
            `${PRODUCTION_URL}/customers/by-interface/${encodeURIComponent(
              customerInfo.interface
            )}`
          );
          setCustomer(res.data);
        } catch (err) {
          console.error("Error fetching customer by interface:", err);
          setCustomer(null);
        } finally {
          setFetchingCustomer(false);
        }
      } else {
        setCustomer(customerInfo?.customer);
        console.log("One",customerInfo)
      }
    };
    fetchFullCustomer();
  }, [customerInfo, isFromWatchlist, isFromOverusage, isFromPitch]);

  // Handle customer data from different sources (DIA list vs Watchlist)
  const customerData = {
    ...customer,
    switchName: customer?.diacustomer?.switchName || customer?.switchName,
    customerName: customer?.customerName || customer?.customerinfo?.customerName,
    interface: customer?.interface,
    cid: customer?.cid || customer?.customerinfo?.cid,
    nbr: customer?.nbr || customer?.customerinfo?.nbr,
  };

  const [formData, setFormData] = useState({
    new_upmbps: "",
    new_downmbps: "",
    type: "temporary",
    duration: "1m",
    approved_by: "",
    account_manager: "",
    upgrade_type: "upgrade",
  });

  const openUpgradeFlow = () => {
    setSelectedCustomer(customerInfo.customer);
    setIsPasswordModalOpen(true);
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (!password) {
      alert("Password is required.");
      return;
    }
    setIsPasswordModalOpen(false);
    setIsUpgradeModalOpen(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleTypeChange = (value) => {
    setFormData((prev) => ({ ...prev, type: value }));
  };

  const handleUpgradeTypeChange = (value) => {
    setFormData((prev) => ({ ...prev, upgrade_type: value }));
  };

  const handleUpgrade = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    const username = authState?.userData?.username;

    if (!username) {
      setError("Authentication failed: Username not found.");
      setLoading(false);
      return;
    }

    const payload = {
      interface: selectedCustomer.interface,
      new_upmbps: Number(formData.new_upmbps),
      new_downmbps: Number(formData.new_downmbps),
      type: formData.type,
      duration: formData.type === "temporary" ? formData.duration : null,
      username,
      password,
      approved_by: formData.approved_by,
      account_manager: formData.account_manager,
      upgrade_type: formData.upgrade_type,
    };

    try {
      const response = await axios.post(`${PRODUCTION_URL}/upgrade`, payload);
      setMessage(response.data.message || "Upgrade successful.");
      setTimeout(() => {
        setIsUpgradeModalOpen(false);
        setPassword("");
        setLoading(false);
      }, 2000);
    } catch (err) {
      console.error("Upgrade error:", err);
      setError(
        err.response?.data?.message || "An error occurred during the upgrade."
      );
      setLoading(false);
    }
  };

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const [editData, setEditData] = useState({
    email_address: customer?.client_db?.email_address || "",
    phone_number: customer?.client_db?.phone_number || "",
    onnet_offnet: customer?.client_db?.onnet_offnet || "onnet",
    customer_name_pastel: customer?.client_db?.customer_name_pastel || "",
    area: customer?.client_db?.area || "",
    first_name: customer?.client_db?.first_name || "",
    provider: customer?.client_db?.provider || "",
    special_comments: customer?.client_db?.special_comments || "",
  });

  // Initialize edit form when customer data loads (reactive)
  useEffect(() => {
    if (customer?.client_db) {
      setEditData({
        email_address: customer.client_db.email_address || "",
        phone_number: customer.client_db.phone_number || "",
        onnet_offnet: customer.client_db.onnet_offnet || "onnet",
        customer_name_pastel: customer.client_db.customer_name_pastel || "",
        area: customer.client_db.area || "",
        first_name: customer.client_db.first_name || "",
        special_comments: customer.client_db.special_comments || "",
        provider: customer.client_db.provider || "",
      });
    }
  }, [customer]);

  const [graphLoading, setGraphLoading] = useState(false);
  const [graphData, setGraphData] = useState([]);
  const [isGraphModalOpen, setIsGraphModalOpen] = useState(false);

  // Map switch names to Zabbix host names
  const getZabbixHostName = (switchName: string) => {
    const hostMapping: Record<string, string> = {
      "LTZ-PE1-RAH": "lo-0.ltz-pe1-rah.liquidtelecom.net",
      "LTZ-P1-DAR": "lo-0.ltz-p1-dar.liquidtelecom.net",
      // Add more mappings here as needed
    };
    return hostMapping[switchName] || switchName;
  };


  const handleFetchGraph = async () => {
    try {
      setGraphLoading(true);

      // 1. LOGIN → get auth key
      const auth = localStorage.getItem("zabbixAuth");

      // 2. GET HOST ID
      const switchName = customerData.switchName;
      const zabbixHostName = getZabbixHostName(switchName);
      
      const host = await zabbixApi({
        method: "host.get",
        params: {
          output: ["hostid"],
          filter: {
            host: [zabbixHostName],
          },
        },
        id: 1,
        auth,
      });

      const hostid =
        Array.isArray(host) && host.length > 0 ? host[0].hostid : undefined;
      if (!hostid) throw new Error("Host ID not found");

      // 3. GET GRAPH + ITEMS (SEARCH INTERFACE)
      const graph = await zabbixApi({
        method: "graph.get",
        params: {
          hostids: [hostid],
          search: { name: customerData.interface },
          output: "extend",
          selectItems: "extend",
        },
        id: 1,
        auth,
      });

      if (!graph.length) throw new Error("Graph not found");

      const itemids = graph[0].items.map((i) => ({
        itemid: i.itemid,
        name: i.name,
      }));

      // Store itemids so ViewGraph page can reuse them
      localStorage.setItem("zabbix_itemids", JSON.stringify(itemids));

      // Navigate to new page
      navigate("/view-graph", {
        state: {
          customer: { ...customer, ...customerData },
          itemids,
        },
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message);
      setGraphLoading(false);
    }
  };

  // Loading state while fetching customer from Watchlist
  if (fetchingCustomer || !customer) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading customer details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Network className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Network Management
              </h1>
              <p className="text-sm text-muted-foreground">
                Customer Connection Details
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FavoriteButton
              customerId={customer?.id?.toString()}
              customerName={customerData.customerName}
              customerType="DIA"
              interface={customerData.interface}
              cid={customerData.cid}
              nbr={customerData.nbr}
            />
            <Button
              onClick={openUpgradeFlow}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              Upgrade/Downgrade
            </Button>
            <Button
              onClick={handleDiagnosis}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              Diagnosis
            </Button>
            {/* <Button
              onClick={handleOpenUptimeModal}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
            >
              Check Uptime
            </Button> */}
                  {/* === Diagnosis Modal === */}
                    <Dialog open={isDiagnosisModalOpen} onOpenChange={setIsDiagnosisModalOpen}>
                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto dark:text-white">
                      <DialogHeader>
                        <DialogTitle>Diagnosis Result</DialogTitle>
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

                          {/* Latency & Ping Results */}
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
                                      className={`rounded-lg p-3 shadow border text-xs mb-2 ${pr.packetLoss > 0 ? "bg-red-50 dark:bg-red-900 border-red-200 dark:border-red-700" : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}
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
                                      <th className="p-1">Label</th>
                                      <th className="p-1">mW</th>
                                      <th className="p-1">dBm</th>
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
                                <div>{diagnosisResult.powerInfo}</div>
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
                                <div>{diagnosisResult.flappedInfo}</div>
                              )}
                            </div>
                          )}

                          {/* Neighbor Switch & Media Info */}
                          {(diagnosisResult.neighborSwitch || diagnosisResult.customerPort || diagnosisResult.mediaType) && (
                            <div className="bg-purple-50 dark:bg-purple-900 rounded-lg p-4 mb-2">
                              <h3 className="font-bold text-purple-700 dark:text-purple-200 mb-2">Neighbor Switch Details</h3>
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                {diagnosisResult.neighborSwitch && (
                                  <>
                                    <div>
                                      <span className="font-semibold">Neighbor Name:</span>{" "}
                                      {diagnosisResult.neighborSwitch.name || "Unknown"}
                                    </div>
                                    <div>
                                      <span className="font-semibold">Neighbor IP:</span>{" "}
                                      {diagnosisResult.neighborSwitch.ip}
                                    </div>
                                  </>
                                )}
                                {diagnosisResult.customerPort && (
                                  <div>
                                    <span className="font-semibold">Customer Port:</span>{" "}
                                    {diagnosisResult.customerPort}
                                  </div>
                                )}
                                {diagnosisResult.mediaType && (
                                  <div>
                                    <span className="font-semibold">Media Type:</span>{" "}
                                    {diagnosisResult.mediaType}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Graph Data */}
                          {diagnosisResult.graphData && diagnosisResult.graphData.sentData && diagnosisResult.graphData.recvData && (() => {
                            // Dynamic unit logic (bps, Kbps, Mbps, Gbps)
                            const sentVals = diagnosisResult.graphData.sentData.map((d: any) => Number(d.value));
                            const recvVals = diagnosisResult.graphData.recvData.map((d: any) => Number(d.value));
                            const allVals = [...sentVals, ...recvVals];
                            const maxValue = Math.max(...allVals);
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

                            // 95th percentile and summary stats helper
                            const calcP95 = (data: any[]) => {
                              if (!data || !data.length)
                                return { p95: 0, max: 0, min: 0, avg: 0, samples: 0 };
                              const values = data.map((d) => Number(d.value));
                              if (!values.length)
                                return { p95: 0, max: 0, min: 0, avg: 0, samples: 0 };
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

                            // Compare p95 usage to provisioned bandwidth (Mbps)
                            const upMbps = (customer as any)?.upmbps ?? (customer as any)?.diacustomer?.upmbps;
                            const downMbps = (customer as any)?.downmbps ?? (customer as any)?.diacustomer?.downmbps;
                            const upCapacityBps = typeof upMbps === "number" ? upMbps * 1_000_000 : null;
                            const downCapacityBps = typeof downMbps === "number" ? downMbps * 1_000_000 : null;

                            // Maxing based on maximum observed usage vs provisioned capacity
                            const uploadPctOfCap = upCapacityBps ? (sentStats.max / upCapacityBps) * 100 : null;
                            const downloadPctOfCap = downCapacityBps ? (recvStats.max / downCapacityBps) * 100 : null;

                            const capacityStatus = (pct: number | null) => {
                              if (pct == null || Number.isNaN(pct)) return "Unknown";
                              if (pct >= 95) return "Maxed";
                              if (pct >= 85) return "Near max";
                              return "Not maxed";
                            };
                            // Detect theme (light/dark) for label color
                            const isDark = document.documentElement.classList.contains('dark');
                            const labelColor = isDark ? '#fff' : '#000';
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
                                        legend: { display: true, labels: { color: labelColor, font: { weight: 'bold' } } },
                                        title: { display: true, text: `Traffic (${displayUnit})`, color: labelColor },
                                      },
                                      interaction: { intersect: false, mode: "index" },
                                      scales: {
                                        x: {
                                          title: { display: true, text: "Time", color: labelColor },
                                          ticks: {
                                            autoSkip: true,
                                            maxRotation: 90,
                                            minRotation: 90,
                                            maxTicksLimit: 32,
                                            color: labelColor,
                                          },
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
                                            <span className="font-semibold">Upload:</span> {" "}
                                            {capacityStatus(uploadPctOfCap)}
                                            {uploadPctOfCap != null && !Number.isNaN(uploadPctOfCap) && (
                                              <span>
                                                {" "}({uploadPctOfCap.toFixed(1)}% of {upMbps} Mbps)
                                              </span>
                                            )}
                                          </div>
                                        )}
                                        {downCapacityBps && (
                                          <div>
                                            <span className="font-semibold">Download:</span> {" "}
                                            {capacityStatus(downloadPctOfCap)}
                                            {downloadPctOfCap != null && !Number.isNaN(downloadPctOfCap) && (
                                              <span>
                                                {" "}({downloadPctOfCap.toFixed(1)}% of {downMbps} Mbps)
                                              </span>
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

                          {/* Healthy customer note */}
                          {/* {diagnosisResult.message === "Customer is healthy" && (
                            <div className="mt-2 text-sm text-green-700 dark:text-green-500 font-bold uppercase">
                              ***Note: Please check the CPE for LAN analysis.
                            </div>
                          )} */}
                        </div>
                      ) : (
                        <div className="text-center py-4">No diagnosis data.</div>
                      )}
                      <DialogFooter>
                        <Button onClick={() => setIsDiagnosisModalOpen(false)} type="button">Close</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* === Uptime Modal === */}
                  {/* <Dialog open={isUptimeModalOpen} onOpenChange={setIsUptimeModalOpen}>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Uptime Analysis</DialogTitle>
                        <DialogDescription>
                          Select a start date (up to the last 90 days). Uptime is
                          calculated based on Zabbix graph samples where traffic
                          &gt; 0 bps is considered UP and 0 bps is DOWN.
                        </DialogDescription>
                      </DialogHeader>

                      {(() => {
                        const now = new Date();
                        const today = now.toISOString().split("T")[0];
                        const ninetyDaysAgo = new Date(
                          now.getTime() - 90 * 24 * 60 * 60 * 1000
                        )
                          .toISOString()
                          .split("T")[0];

                        return (
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label htmlFor="uptime-start-date">Start Date</Label>
                              <Input
                                id="uptime-start-date"
                                type="date"
                                value={uptimeStartDate}
                                min={ninetyDaysAgo}
                                max={today}
                                onChange={(e) => setUptimeStartDate(e.target.value)}
                              />
                              <p className="text-xs text-muted-foreground">
                                Range: from selected date until now (maximum 90 days).
                              </p>
                            </div>

                            {uptimeError && (
                              <p className="text-sm text-red-600">{uptimeError}</p>
                            )}

                            {uptimeLoading ? (
                              <p className="text-sm">Calculating uptime, please wait...</p>
                            ) : (
                              uptimeResult && (
                                <div className="space-y-2 rounded-md border p-3 text-sm">
                                  <p>
                                    <span className="font-semibold">Customer:</span>{" "}
                                    {customerData.customerName}
                                  </p>
                                  <p>
                                    <span className="font-semibold">Interface:</span>{" "}
                                    {uptimeResult.interfaceName}
                                  </p>
                                  <p>
                                    <span className="font-semibold">Percentage Up:</span>{" "}
                                    {uptimeResult.uptimePercentage}%
                                  </p>
                                  <p>
                                    <span className="font-semibold">Percentage Down:</span>{" "}
                                    {uptimeResult.downtimePercentage}%
                                  </p>
                                  <p>
                                    <span className="font-semibold">Start Date:</span>{" "}
                                    {formatDisplayDate(uptimeResult.startDate)}
                                  </p>
                                  <p>
                                    <span className="font-semibold">End Date:</span>{" "}
                                    {formatDisplayDate(uptimeResult.endDate)}
                                  </p>
                                </div>
                              )
                            )}

                            <DialogFooter>
                              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                <Button
                                  type="button"
                                  onClick={handleCheckUptime}
                                  disabled={uptimeLoading}
                                >
                                  {uptimeLoading ? "Checking..." : "Check Uptime"}
                                </Button>
                                {uptimeResult && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleDownloadUptimePdf}
                                  >
                                    Download PDF
                                  </Button>
                                )}
                              </div>
                            </DialogFooter>
                          </div>
                        );
                      })()}
                    </DialogContent>
                  </Dialog> */}
            <Button
              onClick={() => setIsEditModalOpen(true)}
              className="bg-secondary hover:bg-secondary/90 text-secondary-foreground font-semibold"
            >
              Edit Details
            </Button>
            <Button
              onClick={handleFetchGraph}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
            >
              View Traffic Graph
            </Button>
          </div>
        </div>
      </header>

      {/* <CustomerMLAnalysis customerId={customerInfo?.customer?.id} customerType="DIA" customerName={customerData.customerName}/> */}
      {/* Customer Info */}
      <main className="container mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {customerData.customerName}
          </h2>
          <p className="text-muted-foreground">
            Circuit ID: {customerData.cid}
          </p>
        </div>
        <CustomerInfo data={customer} />

        {/* AI Analysis Section */}
        {/* {customer?.id && (
          <div className="mt-8">
            <CustomerMLAnalysis
              customerId={customer.id}
              customerType="DIA"
              customerName={customerData.customerName || ""}
              switchName={customerData.switchName}
              interfaceName={customer.interface}
              upMbps={customer.upmbps}
              downMbps={customer.downmbps}
            />
          </div>
        )} */}
      </main>

      {/* === Password Modal === */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Password for SSH</DialogTitle>
            <DialogDescription>
              Please enter your SSH password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePasswordSubmit}>
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
                value={formData.upgrade_type}
                onValueChange={handleUpgradeTypeChange}
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
                value={formData.new_upmbps}
                onChange={handleFormChange}
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
                value={formData.new_downmbps}
                onChange={handleFormChange}
                required
                className="col-span-3"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Type</Label>
              <RadioGroup
                value={formData.type}
                onValueChange={handleTypeChange}
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

            {formData.type === "temporary" && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="duration" className="text-right">
                  Duration
                </Label>
                <Input
                  id="duration"
                  name="duration"
                  value={formData.duration}
                  onChange={handleFormChange}
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
                value={formData.approved_by}
                onChange={handleFormChange}
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
                value={formData.account_manager}
                onChange={handleFormChange}
                placeholder="Name of account manager"
                required
                className="col-span-3"
              />
            </div>

            {message && <p className="text-green-600 text-center">{message}</p>}
            {error && <p className="text-red-600 text-center">{error}</p>}

            <DialogFooter className="mt-4">
              <Button type="submit" disabled={loading}>
                {loading ? "Processing..." : "Submit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* === Edit Customer Details Modal === */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Customer Details</DialogTitle>
            <DialogDescription>
              Update customer contact and billing information.
              {!customer?.client_db && " This will create a new client record linked to this CID."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                if (!customerData.cid) {
                  alert('CID is required to update client details');
                  return;
                }

                const res = await axios.put(`${PRODUCTION_URL}/client-db/${customerData.cid}`, editData);

                // Refresh customer data if possible
                if (customerData?.id) {
                  const res = await axios.get(`${PRODUCTION_URL}/customers/${customer.id}`);
                  console.log(res);
                  setCustomer(res.data);
                }

                alert("Customer details updated successfully");
                setIsEditModalOpen(false);
              } catch (error: any) {
                alert(error.response?.data?.message || "Update failed");
              }
            }}
            className="grid gap-4 py-4"
          >
            {/* Email */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Email</Label>
              <Input
                value={editData.email_address}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, email_address: e.target.value }))
                }
                className="col-span-3"
                placeholder="customer@example.com"
              />
            </div>
            {/* Phone */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Phone</Label>
              <Input
                value={editData.phone_number}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, phone_number: e.target.value }))
                }
                className="col-span-3"
                placeholder="+255 XXX XXX XXX"
              />
            </div>
            {/* Onnet / Offnet */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Network Type</Label>
              <Select
                value={editData.onnet_offnet}
                onValueChange={(value) =>
                  setEditData((p) => ({ ...p, onnet_offnet: value }))
                }
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="onnet">Onnet</SelectItem>
                  <SelectItem value="offnet">Offnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Pastel Name */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Pastel Name</Label>
              <Input
                value={editData.customer_name_pastel}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, customer_name_pastel: e.target.value }))
                }
                className="col-span-3"
                placeholder="Customer name in Pastel"
              />
            </div>
            {/* Area */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Area</Label>
              <Input
                value={editData.area}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, area: e.target.value }))
                }
                className="col-span-3"
                placeholder="e.g., Dar es Salaam"
              />
            </div>
            {/* Contact Name */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Contact Name</Label>
              <Input
                value={editData.first_name}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, first_name: e.target.value }))
                }
                className="col-span-3"
                placeholder="Contact person name"
              />
            </div>
            {/* Provider */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Provider</Label>
              <Input
                value={editData.provider}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, provider: e.target.value }))
                }
                className="col-span-3"
                placeholder="e.g., Liquid Telecom"
              />
            </div>
            {/* Comments */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Comments</Label>
              <Input
                value={editData.special_comments}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, special_comments: e.target.value }))
                }
                className="col-span-3"
                placeholder="Special notes or comments"
              />
            </div>
            <DialogFooter>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isGraphModalOpen} onOpenChange={setIsGraphModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Traffic Graph</DialogTitle>
          </DialogHeader>

          {!graphData.length ? (
            <p>No data</p>
          ) : (
            <Line
              data={{
                labels: graphData.map((d) =>
                  new Date(d.clock * 1000).toLocaleTimeString()
                ),
                datasets: [
                  {
                    label: "Traffic",
                    data: graphData.map((d) => d.value),
                    borderWidth: 2,
                  },
                ],
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ViewDiaCutomer;

const zabbixApi = async (payload) => {
  const res = await axios.post(
    "https://monitoring.liquidtelecom.net/api_jsonrpc.php",
    {
      jsonrpc: "2.0",
      ...payload,
    },
    {
      headers: { "Content-Type": "application/json", Authorization: undefined, },
    }
  );
  return res.data.result;
};
