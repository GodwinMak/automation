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

const SharedCustomer = () => {
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

  const [statusFilter, setStatusFilter] = useState(initialFilter);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        nbr: nbrSearch,
        search: search
      });

      const response = await axios.get(
        `${PRODUCTION_URL}/export/shared?${params}`,
        { responseType: 'blob' }
      );

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `shared_customers_${statusFilter || 'all'}_${timestamp}.xlsx`;

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
          `${PRODUCTION_URL}/sharedcustomers?page=${page}&pageSize=${pageSize}&search=${search}&status=${statusFilter}&nbr=${nbrSearch}`
        );
        setCustomers(res.data.customers || []);
        setTotalPages(res.data.totalPages);
      } catch (err) {
        console.error("Error fetching Shared customers:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCustomers();
  }, [page, search, pageSize, statusFilter, nbrSearch]);

  const handlePageSizeChange = (value) => {
    setPageSize(Number(value));
    setPage(1);
  };

  const columns = [
    { key: "customerName", label: "Customer Name" },
    { key: "interface", label: "Interface" },
    { key: "nbr", label: "Neighbor" },
    { key: "port", label: "Port" },
    { key: "cid", label: "Circuit ID" },
    { key: "capacity", label: "Capacity (Mbps)" },
    {
      key: "operationalStatus",
      label: "Status",
      render: (customer) => (
        <span
          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
            customer?.sharedcustomer?.operationalStatus === "up"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {customer?.sharedcustomer?.operationalStatus?.toUpperCase() || "N/A"}
        </span>
      ),
    },
    {
      key: "switchName",
      label: "Switch",
      render: (customer) => customer?.sharedcustomer?.switchName,
    },
  ];

  const Action = (customer) => (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => {
          navigate("/view-shared-customer", { state: { customer } });
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
            c?.sharedcustomer?.operationalStatus?.toLowerCase() === statusFilter
        );

  return (
    <div className="p-6 animate-fade-in">
      <ReusableTable
        title="Shared Customers"
        description="Manage available Shared Customers (L2VPN)"
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
                setPage(1);
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
              className="border border-border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary bg-background text-foreground"
            />
            <input
              type="text"
              placeholder="Search NBR..."
              value={nbrSearch}
              onChange={(e) => {
                setNbrSearch(e.target.value);
                setPage(1);
              }}
              className="border border-border rounded-lg px-3 py-1.5 text-sm ml-2 focus:ring-2 focus:ring-primary bg-background text-foreground"
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

export default SharedCustomer;

