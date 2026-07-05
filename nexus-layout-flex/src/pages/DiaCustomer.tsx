import React, { useState, useEffect } from "react";
import axios from "axios";
import { ReusableTable } from "@/components/Table";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Eye, Download } from "lucide-react";
import { useAuthContext } from "@/hooks/useAuthContext";
import { PRODUCTION_URL } from "@/utils/Api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigate, useLocation } from "react-router-dom";

const DiaCustomer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state: locationState } = location;
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(5);
  const { state: authState } = useAuthContext();

  const initialNbr = locationState?.nbr || "";
  const [nbrSearch, setNbrSearch] = useState(initialNbr);

  const initialFilter =
    locationState?.filterType === "up" || locationState?.filterType === "down"
      ? locationState.filterType
      : "all";
  const initialUpgradeFilter =
    locationState?.filterType === "temporary" ? "temporary" : "all";

  const [statusFilter, setStatusFilter] = useState(initialFilter);
  const [upgradeFilter, setUpgradeFilter] = useState(initialUpgradeFilter);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        nbr: nbrSearch,
        search: search
      });

      const response = await axios.get(
        `${PRODUCTION_URL}/export/dia?${params}`,
        { responseType: 'blob' }
      );

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `dia_customers_${statusFilter || 'all'}_${timestamp}.xlsx`;

      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    }
  };

  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/customers?page=${page}&pageSize=${pageSize}&search=${search}&status=${statusFilter}&upgradeType=${upgradeFilter}&nbr=${nbrSearch}`
        );
        setCustomers(res.data.customers || []);
        setTotalPages(res.data.totalPages);
      } catch (err) {
        console.error("Error fetching customers:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCustomers();
  }, [page, search, pageSize, statusFilter, upgradeFilter, nbrSearch]);

  const handlePageSizeChange = (value) => {
    setPageSize(Number(value));
    setPage(1);
  };

  const formatRemainingTime = (expiresAt) => {
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

  const columns = [
    { key: "customerName", label: "Customer Name" },
    { key: "interface", label: "Interface" },
    { key: "nbr", label: "Neighbor" },
    { key: "port", label: "Port" },
    { key: "cid", label: "Circuit ID" },
    { key: "downmbps", label: "Capacity(Mbps)" },
    {
      key: "upgrade_type",
      label: "Upgrade Type",
      render: (customer) =>
        customer?.upgrade_type === "temporary" ? "Temporary" : "Permanent",
    },
    {
      key: "remaining_time",
      label: "Remaining Time",
      render: (customer) => {
        if (customer?.upgrade_type !== "temporary") return "-";
        return formatRemainingTime(customer?.expires_at);
      },
    },
    {
      key: "operationalStatus",
      label: "Status",
      render: (customer) => customer?.diacustomer?.operationalStatus,
    },
    {
      key: "switchName",
      label: "PE||BNG",
      render: (customer) => customer?.diacustomer?.switchName,
    },
  ];
  const Action = (customer) => (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => {
          navigate("/viewcustomer", { state: { customer } });
        }}
      >
        <Eye className="h-4 w-4" />
        View Customer
      </DropdownMenuItem>
    </>
  );

  const filteredCustomers =
    statusFilter === "all"
      ? customers
      : customers.filter(
          (c) =>
            c?.diacustomer?.operationalStatus?.toLowerCase() === statusFilter
        );
  return (
    <div className="p-6">
      <ReusableTable
        title="DIA Customers"
        description="Manage available DIA Customers"
        columns={columns}
        data={filteredCustomers}
        actions={Action}
        loading={loading}
        filters={
          <>
            <label className="mr-2 font-medium">Status:</label>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1); // reset page when filter changes
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Filter Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="up">Up</SelectItem>
                <SelectItem value="down">Down</SelectItem>
              </SelectContent>
            </Select>
            <label className="mr-2 ml-2 font-medium">Upgrade Type:</label>
            <Select
              value={upgradeFilter}
              onValueChange={(value) => {
                setUpgradeFilter(value);
                setPage(1); // reset page when filter changes
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Filter Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="temporary">Temporary</SelectItem>
                <SelectItem value="permanent">Permanent</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        headerActions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export Excel
            </Button>
            <input
              type="text"
              placeholder="Search customer..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 text-black"
            />
            <input
              type="text"
              placeholder="Search NBR..."
              value={nbrSearch}
              onChange={(e) => {
                setNbrSearch(e.target.value);
                setPage(1);
              }}
              className="border rounded-lg px-3 py-1.5 text-sm ml-2 focus:ring-2 focus:ring-blue-500 text-black"
            />
          </>
        }
        pagination={{
          page,
          totalPages,
          onPageChange: (newPage) => setPage(newPage),
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
      />
    </div>
  );
};

export default DiaCustomer;
