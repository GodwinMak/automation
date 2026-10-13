import React, { useState, useEffect } from "react";
import axios from "axios";
import { ReusableTable } from "@/components/Table";
import { PRODUCTION_URL } from "@/utils/Api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  DIA: "DIA",
  IPT: "IPT",
  SHARED: "Shared",
  L3VPN: "L3VPN",
};

const HighProfileCustomers = () => {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("all");

  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          search,
          status: statusFilter,
          serviceType: serviceTypeFilter === "all" ? "" : serviceTypeFilter,
        });
        const res = await axios.get(`${PRODUCTION_URL}/high-profile-customers?${params}`);
        setCustomers(res.data.customers || []);
        setTotalPages(res.data.totalPages || 1);
      } catch (err) {
        console.error("Error fetching high profile customers:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCustomers();
  }, [page, search, pageSize, statusFilter, serviceTypeFilter]);

  const handlePageSizeChange = (value) => {
    setPageSize(Number(value));
    setPage(1);
  };

  const columns = [
    { key: "customerName", label: "Customer Name" },
    {
      key: "customerType",
      label: "Service Type",
      render: (customer) => SERVICE_TYPE_LABELS[customer?.customerType] || customer?.customerType,
    },
    { key: "interface", label: "Interface" },
    { key: "cid", label: "Circuit ID" },
    {
      key: "operationalStatus",
      label: "Status",
      render: (customer) => {
        const opModel = customer?.diacustomer || customer?.iptcustomer || customer?.sharedcustomer || customer?.l3vpncustomer;
        return (
          <span
            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
              opModel?.operationalStatus === "up"
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {opModel?.operationalStatus?.toUpperCase() || "N/A"}
          </span>
        );
      },
    },
    {
      key: "switchName",
      label: "Switch",
      render: (customer) => {
        const opModel = customer?.diacustomer || customer?.iptcustomer || customer?.sharedcustomer || customer?.l3vpncustomer;
        return opModel?.switchName || "-";
      },
    },
  ];

  return (
    <div className="p-6">
      <ReusableTable
        title="High Profile Customers"
        description="Customers flagged as high profile across DIA, IPT, Shared and L3VPN"
        columns={columns}
        data={customers}
        loading={loading}
        filters={
          <>
            <label className="mr-2 font-medium">Service Type:</label>
            <Select
              value={serviceTypeFilter}
              onValueChange={(value) => { setServiceTypeFilter(value); setPage(1); }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Service Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="DIA">DIA</SelectItem>
                <SelectItem value="IPT">IPT</SelectItem>
                <SelectItem value="SHARED">Shared</SelectItem>
                <SelectItem value="L3VPN">L3VPN</SelectItem>
              </SelectContent>
            </Select>

            <label className="mr-2 ml-2 font-medium">Status:</label>
            <Select
              value={statusFilter}
              onValueChange={(value) => { setStatusFilter(value); setPage(1); }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
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
          <input
            type="text"
            placeholder="Search customer..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 text-black"
          />
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

export default HighProfileCustomers;
