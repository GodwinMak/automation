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

const IptCustomer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state: locationState } = location;
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(5);
  const { state: authState, isAdmin } = useAuthContext();

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
        `${PRODUCTION_URL}/export/ipt?${params}`,
        { responseType: 'blob' }
      );

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `ipt_customers_${statusFilter || 'all'}_${timestamp}.xlsx`;

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
          `${PRODUCTION_URL}/iptcustomers?page=${page}&pageSize=${pageSize}&search=${search}&status=${statusFilter}&nbr=${nbrSearch}`
        );
        setCustomers(res.data.customers || []);
        setTotalPages(res.data.totalPages);
      } catch (err) {
        console.error("Error fetching IPT customers:", err);
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

  const handleToggleHighProfile = async (customer, checked) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === customer.id ? { ...c, isHighProfile: checked } : c))
    );
    try {
      const token = localStorage.getItem("userToken");
      await axios.patch(
        `${PRODUCTION_URL}/iptcustomers/${customer.id}/high-profile`,
        { isHighProfile: checked },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error("Failed to update high profile flag:", error);
      setCustomers((prev) =>
        prev.map((c) => (c.id === customer.id ? { ...c, isHighProfile: !checked } : c))
      );
    }
  };

  const columns = [
    { key: "customerName", label: "Customer Name" },
    { key: "interface", label: "Interface" },
    { key: "nbr", label: "Neighbor" },
    { key: "port", label: "Port" },
    { key: "cid", label: "Circuit ID" },
    { key: "asn", label: "ASN" },
    { key: "downmbps", label: "Capacity(Mbps)" },
    {
      key: "operationalStatus",
      label: "Status",
      render: (customer) => customer?.iptcustomer?.operationalStatus,
    },
    {
      key: "switchName",
      label: "PE||BNG",
      render: (customer) => customer?.iptcustomer?.switchName,
    },
    ...(isAdmin()
      ? [
          {
            key: "isHighProfile",
            label: "High Profile",
            render: (customer) => (
              <input
                type="checkbox"
                checked={!!customer?.isHighProfile}
                onChange={(e) => handleToggleHighProfile(customer, e.target.checked)}
                className="h-4 w-4 cursor-pointer"
              />
            ),
          },
        ]
      : []),
  ];

  const Action = (customer) => (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => {
          navigate("/view-ipt-customer", { state: { customer } });
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
            c?.iptcustomer?.operationalStatus?.toLowerCase() === statusFilter
        );

  return (
    <div className="p-6">
      <ReusableTable
        title="IPT Customers"
        description="Manage available IPT Customers"
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

export default IptCustomer;
