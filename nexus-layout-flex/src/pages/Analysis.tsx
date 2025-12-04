import React, { useState, useEffect } from "react";
import axios from "axios";
import { ReusableTable } from "@/components/Table";
import { PRODUCTION_URL } from "@/utils/Api";
import { useNavigate } from "react-router-dom";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Eye, Network, Globe, Share2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Analysis = () => {
  const navigate = useNavigate();

  // DIA State
  const [diaPage, setDiaPage] = useState(1);
  const [diaSearch, setDiaSearch] = useState("");
  const [diaTotalPages, setDiaTotalPages] = useState(1);
  const [diaTotalNbr, setDiaTotalNbr] = useState(0);
  const [diaNbr, setDiaNbr] = useState([]);
  const [diaLoading, setDiaLoading] = useState(false);
  const [diaPageSize, setDiaPageSize] = useState(5);

  // IPT State
  const [iptPage, setIptPage] = useState(1);
  const [iptSearch, setIptSearch] = useState("");
  const [iptTotalPages, setIptTotalPages] = useState(1);
  const [iptTotalNbr, setIptTotalNbr] = useState(0);
  const [iptNbr, setIptNbr] = useState([]);
  const [iptLoading, setIptLoading] = useState(false);
  const [iptPageSize, setIptPageSize] = useState(5);

  // Shared State
  const [sharedPage, setSharedPage] = useState(1);
  const [sharedSearch, setSharedSearch] = useState("");
  const [sharedTotalPages, setSharedTotalPages] = useState(1);
  const [sharedTotalNbr, setSharedTotalNbr] = useState(0);
  const [sharedNbr, setSharedNbr] = useState([]);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedPageSize, setSharedPageSize] = useState(5);

  // Fetch DIA NBR Summary
  useEffect(() => {
    const fetchDiaNbr = async () => {
      setDiaLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/customers/nbr?page=${diaPage}&pageSize=${diaPageSize}&search=${diaSearch}`
        );
        setDiaNbr(res.data.data || []);
        setDiaTotalNbr(res.data.totalItems || 0);
        setDiaTotalPages(res.data.totalPages || 1);
      } catch (err) {
        console.error("Error fetching DIA NBR:", err);
      } finally {
        setDiaLoading(false);
      }
    };

    fetchDiaNbr();
  }, [diaPage, diaSearch, diaPageSize]);

  // Fetch IPT NBR Summary
  useEffect(() => {
    const fetchIptNbr = async () => {
      setIptLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/iptcustomers/nbr?page=${iptPage}&pageSize=${iptPageSize}&search=${iptSearch}`
        );
        setIptNbr(res.data.data || []);
        setIptTotalNbr(res.data.totalItems || 0);
        setIptTotalPages(res.data.totalPages || 1);
      } catch (err) {
        console.error("Error fetching IPT NBR:", err);
      } finally {
        setIptLoading(false);
      }
    };

    fetchIptNbr();
  }, [iptPage, iptSearch, iptPageSize]);

  // Fetch Shared NBR Summary
  useEffect(() => {
    const fetchSharedNbr = async () => {
      setSharedLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/sharedcustomers/nbr?page=${sharedPage}&pageSize=${sharedPageSize}&search=${sharedSearch}`
        );
        setSharedNbr(res.data.data || []);
        setSharedTotalNbr(res.data.totalItems || 0);
        setSharedTotalPages(res.data.totalPages || 1);
      } catch (err) {
        console.error("Error fetching Shared NBR:", err);
      } finally {
        setSharedLoading(false);
      }
    };

    fetchSharedNbr();
  }, [sharedPage, sharedSearch, sharedPageSize]);

  const handleDiaPageSizeChange = (value) => {
    setDiaPageSize(Number(value));
    setDiaPage(1);
  };

  const handleIptPageSizeChange = (value) => {
    setIptPageSize(Number(value));
    setIptPage(1);
  };

  const handleSharedPageSizeChange = (value) => {
    setSharedPageSize(Number(value));
    setSharedPage(1);
  };

  const diaIptColumns = [
    { key: "nbr", label: "Switch Name" },
    { key: "total_downmbps", label: "Total Capacity (Mbps)" },
    { key: "total_customers", label: "Total Customers" },
    { key: "up_customers", label: "Up Customers" },
    { key: "down_customers", label: "Down Customers" },
  ];

  const sharedColumns = [
    { key: "nbr", label: "Switch Name" },
    { key: "total_capacity", label: "Total Capacity (Mbps)" },
    { key: "total_customers", label: "Total Customers" },
    { key: "up_customers", label: "Up Customers" },
    { key: "down_customers", label: "Down Customers" },
  ];

  const DiaAction = (nbr) => (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => {
          navigate("/dia-customer", { state: { nbr: nbr.nbr } });
        }}
      >
        <Eye className="h-4 w-4" />
        View DIA Customers
      </DropdownMenuItem>
    </>
  );

  const IptAction = (nbr) => (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => {
          navigate("/ipt-customer", { state: { nbr: nbr.nbr } });
        }}
      >
        <Eye className="h-4 w-4" />
        View IPT Customers
      </DropdownMenuItem>
    </>
  );

  const SharedAction = (nbr) => (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => {
          navigate("/shared-customer", { state: { nbr: nbr.nbr } });
        }}
      >
        <Eye className="h-4 w-4" />
        View Shared Customers
      </DropdownMenuItem>
    </>
  );

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Network Analysis
        </h1>
        <p className="text-muted-foreground">
          View customer distribution across switches for DIA, IPT, and Shared services.
        </p>
      </div>

      <Tabs defaultValue="dia" className="w-full">
        <TabsList className="mb-4 bg-muted/50">
          <TabsTrigger value="dia" className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            DIA Customers
          </TabsTrigger>
          <TabsTrigger value="ipt" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            IPT Customers
          </TabsTrigger>
          <TabsTrigger value="shared" className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Shared Customers
          </TabsTrigger>
        </TabsList>

        {/* DIA Customer Summary Tab */}
        <TabsContent value="dia">
          <ReusableTable
            title={`${diaTotalNbr} Switches Connecting DIA Customers`}
            description="Summary of DIA customers grouped by NBR (Neighbor Switch)"
            columns={diaIptColumns}
            data={diaNbr}
            actions={DiaAction}
            loading={diaLoading}
            headerActions={
              <input
                type="text"
                placeholder="Search Switch..."
                value={diaSearch}
                onChange={(e) => {
                  setDiaSearch(e.target.value);
                  setDiaPage(1);
                }}
                className="border border-border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary bg-background text-foreground"
              />
            }
            pagination={{
              page: diaPage,
              totalPages: diaTotalPages,
              onPageChange: (newPage) => setDiaPage(newPage),
              pageSize: diaPageSize,
              onPageSizeChange: handleDiaPageSizeChange,
            }}
          />
        </TabsContent>

        {/* IPT Customer Summary Tab */}
        <TabsContent value="ipt">
          <ReusableTable
            title={`${iptTotalNbr} Switches Connecting IPT Customers`}
            description="Summary of IPT customers grouped by NBR (Neighbor Switch)"
            columns={diaIptColumns}
            data={iptNbr}
            actions={IptAction}
            loading={iptLoading}
            headerActions={
              <input
                type="text"
                placeholder="Search Switch..."
                value={iptSearch}
                onChange={(e) => {
                  setIptSearch(e.target.value);
                  setIptPage(1);
                }}
                className="border border-border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary bg-background text-foreground"
              />
            }
            pagination={{
              page: iptPage,
              totalPages: iptTotalPages,
              onPageChange: (newPage) => setIptPage(newPage),
              pageSize: iptPageSize,
              onPageSizeChange: handleIptPageSizeChange,
            }}
          />
        </TabsContent>

        {/* Shared Customer Summary Tab */}
        <TabsContent value="shared">
          <ReusableTable
            title={`${sharedTotalNbr} Switches Connecting Shared Customers`}
            description="Summary of Shared (L2VPN) customers grouped by NBR (Neighbor Switch)"
            columns={sharedColumns}
            data={sharedNbr}
            actions={SharedAction}
            loading={sharedLoading}
            headerActions={
              <input
                type="text"
                placeholder="Search Switch..."
                value={sharedSearch}
                onChange={(e) => {
                  setSharedSearch(e.target.value);
                  setSharedPage(1);
                }}
                className="border border-border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary bg-background text-foreground"
              />
            }
            pagination={{
              page: sharedPage,
              totalPages: sharedTotalPages,
              onPageChange: (newPage) => setSharedPage(newPage),
              pageSize: sharedPageSize,
              onPageSizeChange: handleSharedPageSizeChange,
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Analysis;
