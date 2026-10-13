import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ReusableTable } from "@/components/Table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRODUCTION_URL } from "@/utils/Api";

// Every customer type that logs to a *upgradeinfos table (see
// Models/upgradeinfo.js, iptupgradeinfo.js, l3vpnupgradeinfo.js). SHARED has
// no upgrade_type/upgradeinfos concept and L2VPN has no customerinfo/upgrade
// concept at all, so neither can ever appear here.
type CustomerType = "DIA" | "IPT" | "L3VPN";

const BADGE_VARIANT_BY_TYPE: Record<CustomerType, "default" | "secondary" | "outline"> = {
  DIA: "default",
  IPT: "secondary",
  L3VPN: "outline",
};

interface UpgradeRecord {
  id: string;
  customerType: CustomerType;
  customerName: string | null;
  nbr: string | null;
  interface: string;
  account_manager: string;
  current_bandwidth: number;
  upgrade_bandwidth: number | null;
  downgrade_bandwidth: number | null;
  approved_by: string;
  done_by: string;
  start_date: string | null;
  end_date: string | null;
  downgrade_date: string | null;
}

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString();
};

const UpgradeHistory = () => {
  const [upgrades, setUpgrades] = useState<UpgradeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | CustomerType>("all");
  const [actionFilter, setActionFilter] = useState<"all" | "upgrade" | "downgrade">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const fetchUpgrades = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${PRODUCTION_URL}/upgrade/history`);
        setUpgrades(res.data.upgrades || []);
      } catch (err) {
        console.error("Error fetching upgrade history:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchUpgrades();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return upgrades.filter((u) => {
      if (typeFilter !== "all" && u.customerType !== typeFilter) return false;
      if (actionFilter === "upgrade" && u.upgrade_bandwidth == null) return false;
      if (actionFilter === "downgrade" && u.downgrade_bandwidth == null) return false;
      if (!term) return true;
      return (
        u.customerName?.toLowerCase().includes(term) ||
        u.interface?.toLowerCase().includes(term) ||
        u.nbr?.toLowerCase().includes(term) ||
        u.account_manager?.toLowerCase().includes(term) ||
        u.approved_by?.toLowerCase().includes(term) ||
        u.done_by?.toLowerCase().includes(term)
      );
    });
  }, [upgrades, search, typeFilter, actionFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, actionFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedData = filtered.slice((page - 1) * pageSize, page * pageSize);

  const columns = [
    {
      key: "customerType" as const,
      label: "Type",
      render: (u: UpgradeRecord) => (
        <Badge variant={BADGE_VARIANT_BY_TYPE[u.customerType]}>{u.customerType}</Badge>
      ),
    },
    { key: "customerName" as const, label: "Customer Name", render: (u: UpgradeRecord) => u.customerName || "-" },
    { key: "interface" as const, label: "Interface" },
    { key: "nbr" as const, label: "NBR" },
    {
      key: "current_bandwidth" as const,
      label: "Action",
      render: (u: UpgradeRecord) =>
        u.upgrade_bandwidth != null ? (
          <span className="text-success">
            ↑ Upgrade: {u.current_bandwidth} → {u.upgrade_bandwidth} Mbps
          </span>
        ) : u.downgrade_bandwidth != null ? (
          <span className="text-destructive">
            ↓ Downgrade: {u.current_bandwidth} → {u.downgrade_bandwidth} Mbps
          </span>
        ) : (
          `${u.current_bandwidth} Mbps`
        ),
    },
    {
      key: "end_date" as const,
      label: "Duration",
      render: (u: UpgradeRecord) => (u.end_date ? "Temporary" : "Permanent"),
    },
    { key: "account_manager" as const, label: "Account Manager" },
    { key: "approved_by" as const, label: "Approved By" },
    { key: "done_by" as const, label: "Done By" },
    {
      key: "start_date" as const,
      label: "Start Date",
      render: (u: UpgradeRecord) => formatDate(u.start_date),
    },
    {
      key: "downgrade_date" as const,
      label: "End / Reverted",
      render: (u: UpgradeRecord) => formatDate(u.downgrade_date || u.end_date),
    },
  ];

  return (
    <div className="p-6">
      <ReusableTable
        title="Upgrade History"
        description="Every bandwidth upgrade and downgrade ever applied, across DIA, IPT and L3VPN customers"
        columns={columns}
        data={pagedData}
        loading={loading}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search customer, interface, NBR, approver..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="DIA">DIA</SelectItem>
                <SelectItem value="IPT">IPT</SelectItem>
                <SelectItem value="L3VPN">L3VPN</SelectItem>
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as typeof actionFilter)}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="upgrade">Upgrades</SelectItem>
                <SelectItem value="downgrade">Downgrades</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        pagination={{
          page,
          totalPages,
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: (s) => {
            setPageSize(s);
            setPage(1);
          },
        }}
      />
    </div>
  );
};

export default UpgradeHistory;
