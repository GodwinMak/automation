import React, { useState, useEffect } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { CloudCog, Network, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocation } from "react-router-dom";
import { PRODUCTION_URL } from "@/utils/Api";
import { FavoriteButton } from "@/components/FavoriteButton";
import { Line } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";
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

const ViewSharedCustomer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state: customerInfo } = location;

  const [graphLoading, setGraphLoading] = useState(false);
  const [graphData, setGraphData] = useState([]);
  const [isGraphModalOpen, setIsGraphModalOpen] = useState(false);
  const [fetchingCustomer, setFetchingCustomer] = useState(false);
  const [customer, setCustomer] = useState<any>(null);

  // Detect if coming from Watchlist (flat data without nested sharedcustomer)
  const isFromWatchlist = customerInfo?.customer && !customerInfo?.customer?.sharedcustomer;
  console.log(isFromWatchlist);

  // Fetch full customer data if coming from Watchlist
  useEffect(() => {
    const fetchFullCustomer = async () => {
      if (isFromWatchlist && customerInfo?.customer?.customerId) {
        setFetchingCustomer(true);
        try {
          const res = await axios.get(
            `${PRODUCTION_URL}/sharedcustomers/${customerInfo.customer.customerId}`
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

  // Handle customer data from different sources (Shared list vs Watchlist)
  const customerData = {
    ...customer,
    switchName: customer?.sharedcustomer?.switchName || customer?.switchName,
    customerName: customer?.customerName || customer?.sharedcustomerinfo?.customerName,
    interface: customer?.interface,
    cid: customer?.cid || customer?.sharedcustomerinfo?.cid,
    nbr: customer?.nbr || customer?.sharedcustomerinfo?.nbr,
    operationalStatus: customer?.sharedcustomer?.operationalStatus || customer?.status,
    adminStatus: customer?.sharedcustomer?.adminStatus || customer?.adminStatus,
    description: customer?.sharedcustomer?.description || customer?.description,
    capacity: customer?.capacity || customer?.sharedcustomerinfo?.capacity,
  };

  // Map switch names to Zabbix host names
  const getZabbixHostName = (switchName: string) => {
    const hostMapping: Record<string, string> = {
      "LTZ-PE1-RAH": "lo-0.ltz-pe1-rah.liquidtelecom.net",
      "LTZ-P1-DAR": "lo-0.ltz-p1-dar.liquidtelecom.net",
      "LTZ-ACC2-RAH": "lo-0.ltz-acc2-rah.liquidtelecom.net",
      "LTZ-ACC3-RAH": "lo-0.ltz-acc3-rah.liquidtelecom.net",
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

      const hostid = host[0]?.hostid;
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
          type: "shared",
        },
      });
    } catch (err) {
      console.error(err);
      alert(err.message);
      setGraphLoading(false);
    }
  };

  // Customer info display component
  const SharedCustomerInfo = ({ data, customerData }) => {
    const infoItems = [
      { label: "Customer Name", value: customerData?.customerName || data?.customerName },
      { label: "Interface", value: customerData?.interface || data?.interface },
      { label: "Neighbor (NBR)", value: customerData?.nbr || data?.nbr },
      { label: "Port", value: data?.port },
      { label: "Circuit ID", value: customerData?.cid || data?.cid },
      { label: "Capacity (Mbps)", value: customerData?.capacity || data?.capacity },
      { label: "Operational Status", value: customerData?.operationalStatus || data?.sharedcustomer?.operationalStatus },
      { label: "Admin Status", value: customerData?.adminStatus || data?.sharedcustomer?.adminStatus },
      { label: "Switch Name", value: customerData?.switchName || data?.sharedcustomer?.switchName },
      { label: "Description", value: customerData?.description || data?.sharedcustomer?.description },
    ];

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {infoItems.map((item, index) => (
          <div
            key={index}
            className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-shadow"
          >
            <p className="text-sm text-muted-foreground mb-1">{item.label}</p>
            <p className="text-lg font-semibold text-foreground">
              {item.value || "N/A"}
            </p>
          </div>
        ))}
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
    <div className="bg-background animate-fade-in">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Share2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Shared Customer (L2VPN)
              </h1>
              <p className="text-sm text-muted-foreground">
                Customer Connection Details
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FavoriteButton
              customerId={customer?.id?.toString()}
              customerName={customer?.customerName}
              customerType="Shared"
              interface={customer?.interface}
              cid={customer?.cid}
              nbr={customer?.nbr}
            />
            <Button
              onClick={handleFetchGraph}
              disabled={graphLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
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
            <p>Capacity: {customerData.capacity || "N/A"} Mbps</p>
          </div>
          <div className="mt-2">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                customerData.operationalStatus === "up"
                  ? "bg-success/10 text-success border border-success/20"
                  : "bg-destructive/10 text-destructive border border-destructive/20"
              }`}
            >
              {customerData.operationalStatus?.toUpperCase() || "UNKNOWN"}
            </span>
          </div>
        </div>

        <SharedCustomerInfo data={customer} customerData={customerData} />
      </main>

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
    </div>
  );
};

export default ViewSharedCustomer;

const zabbixApi = async (payload) => {
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

