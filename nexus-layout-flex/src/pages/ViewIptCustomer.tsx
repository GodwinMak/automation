import React, { useState, useEffect } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Network, Stethoscope } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation } from "react-router-dom";
import { PRODUCTION_URL } from "@/utils/Api";
import { FavoriteButton } from "@/components/FavoriteButton";
import { Line } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";
import CustomerMLAnalysis from "@/components/CustomerMLAnalysis";
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

const ViewIptCustomer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state: customerInfo } = location;

  const [graphLoading, setGraphLoading] = useState(false);
  const [graphData, setGraphData] = useState([]);
  const [isGraphModalOpen, setIsGraphModalOpen] = useState(false);
  const [fetchingCustomer, setFetchingCustomer] = useState(false);
  const [customer, setCustomer] = useState<any>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  // Diagnosis state
  const [isDiagnosisModalOpen, setIsDiagnosisModalOpen] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<any>(null);
  const [diagnosisError, setDiagnosisError] = useState("");

  // Detect if coming from Watchlist (flat data without nested iptcustomer)
  const isFromWatchlist = customerInfo?.customer && !customerInfo?.customer?.iptcustomer;

  // Fetch full customer data if coming from Watchlist
  useEffect(() => {
    const fetchFullCustomer = async () => {
      if (isFromWatchlist && customerInfo?.customer?.customerId) {
        setFetchingCustomer(true);
        try {
          const res = await axios.get(
            `${PRODUCTION_URL}/iptcustomers/${customerInfo.customer.customerId}`
          );
          setCustomer(res.data);
        } catch (err) {
          console.error("Error fetching customer:", err);
          setCustomer(customerInfo?.customer);
        } finally {
          setFetchingCustomer(false);
        }
      } else {
        setCustomer(customerInfo?.customer);
      }
    };
    fetchFullCustomer();
  }, [customerInfo, isFromWatchlist]);

  // Handle customer data from different sources (IPT list vs Watchlist)
  const customerData = {
    ...customer,
    switchName: customer?.iptcustomer?.switchName || customer?.switchName,
    customerName: customer?.customerName || customer?.iptcustomerinfo?.customerName,
    interface: customer?.interface,
    cid: customer?.cid || customer?.iptcustomerinfo?.cid,
    nbr: customer?.nbr || customer?.iptcustomerinfo?.nbr,
    operationalStatus: customer?.iptcustomer?.operationalStatus || customer?.status,
    adminStatus: customer?.iptcustomer?.adminStatus || customer?.adminStatus,
    description: customer?.iptcustomer?.description || customer?.description,
    destination: customer?.iptcustomer?.destination || customer?.destination,
  };

  // Edit form data state
  const [editData, setEditData] = useState({
    email_address: "",
    phone_number: "",
    onnet_offnet: "onnet",
    customer_name_pastel: "",
    area: "",
    first_name: "",
    special_comments: "",
    provider: "",
  });

  // Initialize edit form when customer data loads
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

  // Handle edit form submission
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!customerData.cid) {
      alert("CID is required to update client details");
      return;
    }

    setEditLoading(true);
    try {
      // Prefer customer-specific endpoint
      if (customer?.id) {
        await axios.put(`${PRODUCTION_URL}/iptcustomers/${customer.id}/client-db`, editData);

        // Refresh customer data
        const res = await axios.get(`${PRODUCTION_URL}/iptcustomers/${customer.id}`);
        setCustomer(res.data);
      } else {
        // Fallback to CID-based endpoint
        await axios.put(`${PRODUCTION_URL}/client-db/${customerData.cid}`, editData);
      }

      alert("Customer details updated successfully");
      setIsEditModalOpen(false);
    } catch (error: any) {
      alert(error.response?.data?.message || "Update failed");
    } finally {
      setEditLoading(false);
    }
  };

  const handleDiagnosis = async () => {
    setDiagnosisResult(null);
    setDiagnosisError("");
    setDiagnosisLoading(true);
    setIsDiagnosisModalOpen(true);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/diagnosis/ipt`, {
        interfaceName: customerData.interface,
      });
      setDiagnosisResult(res.data);
      console.log(res.data)
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
      "LTZ-P1-DAR": "lo-0.ltz-p1-dar.liquidtelecom.net",
      // Add more mappings here as needed
    };
    return hostMapping[switchName] || switchName;
  };

  const handleFetchGraph = async () => {
    try {
      setGraphLoading(true);

      const auth = localStorage.getItem("zabbixAuth");

      // GET HOST ID
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
      console.log(host)
      const hostid =
        Array.isArray(host) && host.length > 0 ? host[0].hostid : undefined;
      if (!hostid) throw new Error("Host ID not found");

      // GET GRAPH + ITEMS (SEARCH INTERFACE)
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

      const itemids = graph[0].items.map((i) => ({
        itemid: i.itemid,
        name: i.name,
      }));

      localStorage.setItem("zabbix_itemids", JSON.stringify(itemids));

      navigate("/view-graph", {
        state: {
          customer: customer,
          itemids,
          type: "ipt",
        },
      });
    } catch (err) {
      console.error(err);
      alert(err.message);
      setGraphLoading(false);
    }
  };

  // Customer info display component for IPT
  const IptCustomerInfo = ({ data, customerData }) => {
    const infoItems = [
      { label: "Customer Name", value: customerData?.customerName || data?.customerName },
      { label: "Interface", value: customerData?.interface || data?.interface },
      { label: "Neighbor (NBR)", value: customerData?.nbr || data?.nbr },
      { label: "Port", value: data?.port },
      { label: "Circuit ID", value: customerData?.cid || data?.cid },
      { label: "ASN", value: data?.asn },
      { label: "Upload (Mbps)", value: data?.upmbps },
      { label: "Download (Mbps)", value: data?.downmbps },
      { label: "Operational Status", value: customerData?.operationalStatus || data?.iptcustomer?.operationalStatus },
      { label: "Admin Status", value: customerData?.adminStatus || data?.iptcustomer?.adminStatus },
      { label: "Switch Name (PE/BNG)", value: customerData?.switchName || data?.iptcustomer?.switchName },
      { label: "Destination", value: customerData?.destination || data?.iptcustomer?.destination },
      { label: "Description", value: customerData?.description || data?.iptcustomer?.description },
    ];

    // Client DB info items
    const clientDbItems = data?.client_db ? [
      { label: "Pastel Name", value: data.client_db.customer_name_pastel },
      { label: "Email Address", value: data.client_db.email_address },
      { label: "Phone Number", value: data.client_db.phone_number },
      { label: "Area", value: data.client_db.area },
      { label: "Network Type", value: data.client_db.onnet_offnet?.toUpperCase() },
      { label: "Provider", value: data.client_db.provider },
      { label: "Contact Name", value: data.client_db.first_name },
      { label: "Comments", value: data.client_db.special_comments },
    ] : [];

    return (
      <div className="space-y-8">
        {/* Network Information */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">Network Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {infoItems.map((item, index) => (
              <div
                key={index}
                className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <p className="text-sm text-muted-foreground mb-1">{item.label}</p>
                <p className="text-lg font-semibold text-foreground">
                  {item.value || "N/A"}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Client/Billing Information */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Client/Billing Information
            {!data?.client_db && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Not linked - Click "Edit Details" to add)
              </span>
            )}
          </h3>
          {clientDbItems.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {clientDbItems.map((item, index) => (
                <div
                  key={index}
                  className="bg-card border border-blue-500/30 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <p className="text-sm text-blue-400 mb-1">{item.label}</p>
                  <p className="text-lg font-semibold text-foreground">
                    {item.value || "N/A"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-card border border-dashed border-border rounded-lg p-6 text-center">
              <p className="text-muted-foreground">
                No billing information linked to this customer.
                Click "Edit Details" to add contact and billing information.
              </p>
            </div>
          )}
        </div>
      </div>
    );
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
                IPT Network Management
              </h1>
              <p className="text-sm text-muted-foreground">
                IPT Customer Connection Details
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FavoriteButton
              customerId={customer?.id?.toString()}
              customerName={customer?.customerName}
              customerType="IPT"
              interface={customer?.interface}
              cid={customer?.cid}
              nbr={customer?.nbr}
            />
            <Button
              onClick={handleDiagnosis}
              disabled={diagnosisLoading}
              className="bg-orange-600 hover:bg-orange-700 text-white font-semibold"
            >
              <Stethoscope className="w-4 h-4 mr-2" />
              {diagnosisLoading ? "Diagnosing..." : "Diagnose"}
            </Button>
            <Button
              onClick={() => setIsEditModalOpen(true)}
              className="bg-secondary hover:bg-secondary/90 text-secondary-foreground font-semibold"
            >
              Edit Details
            </Button>
            <Button
              onClick={handleFetchGraph}
              disabled={graphLoading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
            >
              {graphLoading ? "Loading..." : "View Traffic Graph"}
            </Button>
          </div>
        </div>
      </header>

      {/* Customer Info */}
      <main className="container mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {customerData.customerName}
          </h2>
          <div className="flex gap-4 text-muted-foreground">
            <p>Circuit ID: {customerData.cid || "N/A"}</p>
            <p>ASN: {customer?.asn || "N/A"}</p>
          </div>
          <div className="mt-2">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                customerData.operationalStatus === "up"
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              }`}
            >
              {customerData.operationalStatus?.toUpperCase() || "UNKNOWN"}
            </span>
          </div>
        </div>

        <IptCustomerInfo data={customer} customerData={customerData} />

        {/* AI Analysis Section */}
        {/* {customer?.id && (
          <div className="mt-8">
            <CustomerMLAnalysis
              customerId={customer.id}
              customerType="IPT"
              customerName={customerData.customerName || ""}
              switchName={customerData.switchName}
              interfaceName={customer.interface}
              upMbps={customer.capacity}
              downMbps={customer.capacity}
            />
          </div>
        )} */}
      </main>

      {/* Diagnosis Modal */}
      <Dialog open={isDiagnosisModalOpen} onOpenChange={setIsDiagnosisModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stethoscope className="w-5 h-5 text-orange-500" />
              IPT Customer Diagnosis
            </DialogTitle>
            <DialogDescription>
              {customerData.interface} — {customerData.switchName}
            </DialogDescription>
          </DialogHeader>

          {diagnosisLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4" />
              <p className="text-muted-foreground">Running diagnosis, please wait...</p>
            </div>
          )}

          {diagnosisError && !diagnosisLoading && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-500 font-medium">{diagnosisError}</p>
            </div>
          )}

          {diagnosisResult && !diagnosisLoading && (() => {
            const r = diagnosisResult;

            // --- Graph rendering ---
            const graphDataObj = r.graphData;
            let graphSection: React.ReactNode = null;
            if (graphDataObj?.sentData?.length || graphDataObj?.recvData?.length) {
              const sentRaw: { clock: string; value: string }[] = graphDataObj.sentData || [];
              const recvRaw: { clock: string; value: string }[] = graphDataObj.recvData || [];
              const allValues = [...sentRaw, ...recvRaw].map((d) => parseFloat(d.value));
              const maxVal = Math.max(...allValues, 0);
              let divisor = 1;
              let unit = "bps";
              if (maxVal >= 1e9) { divisor = 1e9; unit = "Gbps"; }
              else if (maxVal >= 1e6) { divisor = 1e6; unit = "Mbps"; }
              else if (maxVal >= 1e3) { divisor = 1e3; unit = "Kbps"; }

              const labels = sentRaw.map((d) =>
                new Date(parseInt(d.clock) * 1000).toLocaleTimeString()
              );

              const sentValues = sentRaw.map((d) => parseFloat(d.value) / divisor);
              const recvValues = recvRaw.map((d) => parseFloat(d.value) / divisor);

              const sorted95 = (arr: number[]) => {
                if (!arr.length) return 0;
                const s = [...arr].sort((a, b) => a - b);
                return s[Math.floor(s.length * 0.95)];
              };
              const p95Sent = sorted95(sentValues);
              const p95Recv = sorted95(recvValues);

              const upCap = customer?.upmbps ? parseFloat(customer.upmbps) : null;
              const downCap = customer?.downmbps ? parseFloat(customer.downmbps) : null;

              graphSection = (
                <div className="mt-6">
                  <h4 className="font-semibold text-foreground mb-3">Traffic Graph (Last 6h)</h4>
                  <Line
                    data={{
                      labels,
                      datasets: [
                        {
                          label: `Sent (${unit})`,
                          data: sentValues,
                          borderColor: "rgb(59,130,246)",
                          backgroundColor: "rgba(59,130,246,0.1)",
                          borderWidth: 2,
                          pointRadius: 0,
                          tension: 0.3,
                        },
                        {
                          label: `Received (${unit})`,
                          data: recvValues,
                          borderColor: "rgb(34,197,94)",
                          backgroundColor: "rgba(34,197,94,0.1)",
                          borderWidth: 2,
                          pointRadius: 0,
                          tension: 0.3,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      plugins: {
                        legend: { position: "top" },
                        title: { display: true, text: `Interface Traffic — ${customerData.interface}` },
                      },
                      scales: {
                        y: { beginAtZero: true, title: { display: true, text: unit } },
                        x: { ticks: { maxTicksLimit: 10 } },
                      },
                    }}
                  />
                  <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3">
                      <p className="text-blue-400 font-medium">P95 Sent</p>
                      <p className="text-foreground font-semibold">{p95Sent.toFixed(2)} {unit}</p>
                      {upCap && (
                        <p className={`text-xs mt-1 ${p95Sent / divisor * 1e6 > upCap * 0.9 * 1e6 ? "text-red-400" : "text-muted-foreground"}`}>
                          Capacity: {upCap} Mbps {p95Sent * (divisor === 1e6 ? 1 : divisor / 1e6) > upCap * 0.9 ? "⚠ Near limit" : "✓ OK"}
                        </p>
                      )}
                    </div>
                    <div className="bg-green-500/10 border border-green-500/20 rounded p-3">
                      <p className="text-green-400 font-medium">P95 Received</p>
                      <p className="text-foreground font-semibold">{p95Recv.toFixed(2)} {unit}</p>
                      {downCap && (
                        <p className={`text-xs mt-1 ${p95Recv * (divisor === 1e6 ? 1 : divisor / 1e6) > downCap * 0.9 ? "text-red-400" : "text-muted-foreground"}`}>
                          Capacity: {downCap} Mbps {p95Recv * (divisor === 1e6 ? 1 : divisor / 1e6) > downCap * 0.9 ? "⚠ Near limit" : "✓ OK"}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div className="space-y-4">
                {/* Status */}
                <p className="font-semibold text-primary text-base">{r.message}</p>

                {/* Customer IP + ASN */}
                {r.customerIp && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-card border border-border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Customer IP</p>
                      <p className="font-semibold text-foreground">{r.customerIp}</p>
                    </div>
                    <div className="bg-card border border-border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">BGP ASN</p>
                      <p className="font-semibold text-foreground">{r.customerAsn || "Not found"}</p>
                    </div>
                  </div>
                )}

                {/* BGP Routes */}
                {r.bgpRoutes?.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-foreground mb-2">
                      BGP Routes Received ({r.bgpRouteCount})
                    </h4>
                    <div className="bg-muted/30 border border-border rounded-lg p-3 max-h-48 overflow-y-auto">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                        {r.bgpRoutes.map((route: string, i: number) => (
                          <span key={i} className="text-xs font-mono bg-card border border-border rounded px-2 py-1">
                            {route}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {r.customerAsn && !r.bgpRoutes?.length && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <p className="text-yellow-500 text-sm">BGP session found but no routes received.</p>
                  </div>
                )}

                {/* Neighbor details (shown when down) */}
                {r.flappedInfo && (
                  <div className="bg-card border border-border rounded-lg p-4 space-y-2">
                    <h4 className="font-semibold text-foreground">Neighbor Info</h4>
                    {r.customerPort && <p className="text-sm"><span className="text-muted-foreground">Port:</span> {r.customerPort}</p>}
                    {r.neighborSwitch && (
                      <p className="text-sm"><span className="text-muted-foreground">Neighbor Switch:</span> {r.neighborSwitch.name || r.neighborSwitch.ip}</p>
                    )}
                    {typeof r.flappedInfo === "object" && !Array.isArray(r.flappedInfo) ? (
                      <p className="text-sm"><span className="text-muted-foreground">Last Flapped:</span> {r.flappedInfo.lastFlapped} ({r.flappedInfo.durationAgo} ago)</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">{String(r.flappedInfo)}</p>
                    )}
                    {r.mediaType && <p className="text-sm"><span className="text-muted-foreground">Media:</span> {r.mediaType}</p>}
                    {Array.isArray(r.powerInfo) && r.powerInfo.map((p: any, i: number) => (
                      <p key={i} className="text-sm">
                        <span className="text-muted-foreground">{p.label}:</span> {p.mW} mW / {p.dBm} dBm
                      </p>
                    ))}
                  </div>
                )}

                {graphSection}
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDiagnosisModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Graph Modal */}
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

      {/* Edit Customer Details Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Customer Details</DialogTitle>
            <DialogDescription>
              Update customer contact and billing information.
              {!customer?.client_db && " This will create a new client record linked to this CID."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="grid gap-4 py-4">
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
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ViewIptCustomer;

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

