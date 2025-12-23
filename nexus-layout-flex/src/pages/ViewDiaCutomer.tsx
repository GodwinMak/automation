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
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

const ViewDiaCutomer = () => {
  const navigate = useNavigate();
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
  console.log("customerInfo", customerInfo);



  // Fetch full customer data if coming from Watchlist
  useEffect(() => {
    const fetchFullCustomer = async () => {
      if (isFromWatchlist && customerInfo?.customer?.customerId) {
        setFetchingCustomer(true);
        try {
  console.log(isFromWatchlist);

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
      } else {
        setCustomer(customerInfo?.customer);
      }
    };
    fetchFullCustomer();
  }, [customerInfo, isFromWatchlist]);

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
    email: customer?.client_db?.email_address || "",
    phone: customer?.client_db?.phone_number || "",
    onnet_offnet: customer?.client_db?.onnet_offnet || "onnet",
    pastel_name: customer?.client_db?.customer_name_pastel || "",
    area: customer?.client_db?.area || "",
  });

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

      const hostid = host[0]?.hostid;
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
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await axios.put(`${PRODUCTION_URL}/customer/update`, {
                  id: customer?.id,
                  ...editData,
                });
                alert("Customer updated successfully");
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
                value={editData.email}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, email: e.target.value }))
                }
                className="col-span-3"
              />
            </div>

            {/* Phone */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Phone</Label>
              <Input
                value={editData.phone}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, phone: e.target.value }))
                }
                className="col-span-3"
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
                value={editData.pastel_name}
                onChange={(e) =>
                  setEditData((p) => ({ ...p, pastel_name: e.target.value }))
                }
                className="col-span-3"
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
  console.log(payload);
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
