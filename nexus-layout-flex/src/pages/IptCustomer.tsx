import React, { useState, useEffect } from "react";
import axios from "axios";
import { ReusableTable } from "@/components/Table";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Eye } from "lucide-react";
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
  const { state: authState } = useAuthContext();

  const initialNbr = locationState?.nbr || "";
  const [nbrSearch, setNbrSearch] = useState(initialNbr);

  const initialFilter =
    locationState?.filterType === "up" || locationState?.filterType === "down"
      ? locationState.filterType
      : "all";

  const [statusFilter, setStatusFilter] = useState(initialFilter);

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
