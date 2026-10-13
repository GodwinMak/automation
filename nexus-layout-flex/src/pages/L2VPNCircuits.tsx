import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate, useLocation } from "react-router-dom";
import { ReusableTable } from "@/components/Table";
import { L2VPNPathChain } from "@/components/L2VPNPathChain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, Search } from "lucide-react";
import { PRODUCTION_URL } from "@/utils/Api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthContext } from "@/hooks/useAuthContext";

type L2VPNCircuit = {
  id: string;
  customerName: string;
  isHighProfile?: boolean;
  status: "complete" | "needs-review" | "off-net" | "vpls";
  overallOperationalStatus: "up" | "down" | "mixed";
  path: string[];
  hops: {
    switchName: string;
    interface: string;
    unit: string;
    adminStatus: string;
    operationalStatus: string;
    vlanId: string | null;
    virtualCircuitId: string | null;
    neighbor: string | null;
    backupNeighbor: string | null;
    inputMbps: number | null;
    outputMbps: number | null;
  }[];
  viaBackupNeighbor?: boolean;
};

const statusPillClasses = (status: "up" | "down" | "mixed") => {
  if (status === "up") {
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  }
  if (status === "down") {
    return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
};

const L2VPNCircuits = () => {
  const { isAdmin } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { state: locationState } = location;
  const [circuits, setCircuits] = useState<L2VPNCircuit[]>([]);
  const [search, setSearch] = useState(locationState?.search || "");
  const [statusFilter, setStatusFilter] = useState("all");
  const initialOperationalStatusFilter =
    locationState?.filterType === "up" ||
    locationState?.filterType === "down" ||
    locationState?.filterType === "mixed"
      ? locationState.filterType
      : "all";
  const [operationalStatusFilter, setOperationalStatusFilter] = useState(
    initialOperationalStatusFilter
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchCircuits = async () => {
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/l2vpncircuits?page=${page}&pageSize=${pageSize}&search=${search}&status=${statusFilter}&operationalStatus=${operationalStatusFilter}`
        );
        setCircuits(res.data.circuits || []);
        setTotalPages(res.data.totalPages || 1);
      } catch (err) {
        console.error("Error fetching L2VPN circuits:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCircuits();
  }, [page, pageSize, search, statusFilter, operationalStatusFilter]);

  const handlePageSizeChange = (value: number) => {
    setPageSize(value);
    setPage(1);
  };

  const handleToggleHighProfile = async (circuit: L2VPNCircuit, checked: boolean) => {
    setCircuits((prev) => prev.map((c) => (c.id === circuit.id ? { ...c, isHighProfile: checked } : c)));
    try {
      const token = localStorage.getItem("userToken");
      await axios.patch(
        `${PRODUCTION_URL}/l2vpncircuits/${circuit.id}/high-profile`,
        { isHighProfile: checked },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error("Failed to update high profile flag for L2VPN:", error);
      setCircuits((prev) => prev.map((c) => (c.id === circuit.id ? { ...c, isHighProfile: !checked } : c)));
    }
  };

  const columns = [
    { key: "customerName" as const, label: "Customer Name" },
    {
      key: "path" as const,
      label: "Layer 2 Path",
      render: (circuit: L2VPNCircuit) => (
        <L2VPNPathChain hops={circuit.hops} size="sm" connected={circuit.status === "complete"} />
      ),
    },
    {
      key: "status" as const,
      label: "Status",
      render: (circuit: L2VPNCircuit) => (
        <div className="flex flex-col gap-1">
          <span
            className={`inline-flex w-fit items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusPillClasses(
              circuit.overallOperationalStatus
            )}`}
          >
            {circuit.overallOperationalStatus.toUpperCase()}
          </span>
          {circuit.status === "needs-review" && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              Needs review
            </span>
          )}
          {circuit.status === "off-net" && (
            <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
              Off-net
            </span>
          )}
          {circuit.status === "vpls" && (
            <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">
              VPLS
            </span>
          )}
          {circuit.viaBackupNeighbor && (
            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
              Via backup-neighbor
            </span>
          )}
        </div>
      ),
    },
    {
      key: "hops" as const,
      label: "VLAN",
      render: (circuit: L2VPNCircuit) => circuit.hops?.[0]?.vlanId || "N/A",
    },
    ...(isAdmin()
      ? [
          {
            key: "isHighProfile" as const,
            label: "High Profile",
            render: (circuit: L2VPNCircuit) => (
              <input
                type="checkbox"
                checked={!!circuit.isHighProfile}
                onChange={(e) => handleToggleHighProfile(circuit, e.target.checked)}
                className="h-4 w-4 cursor-pointer"
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <ReusableTable
      title="L2VPN Circuits"
      description="Layer 2 circuits correlated across devices by circuit ID / VLAN / neighbor"
      data={circuits}
      columns={columns}
      loading={loading}
      actions={(circuit: L2VPNCircuit) => (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => navigate("/view-l2vpn-circuit", { state: { circuit } })}
        >
          <Eye className="w-4 h-4 mr-2" />
          View Details
        </Button>
      )}
      filters={
        <>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search customer, VLAN ID, or circuit ID..."
              className="pl-8 w-56"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="needs-review">Needs Review</SelectItem>
              <SelectItem value="off-net">Off-Net</SelectItem>
              <SelectItem value="vpls">VPLS</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={operationalStatusFilter}
            onValueChange={(value) => {
              setOperationalStatusFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Link Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Links</SelectItem>
              <SelectItem value="up">Up</SelectItem>
              <SelectItem value="down">Down</SelectItem>
              <SelectItem value="mixed">Mixed</SelectItem>
            </SelectContent>
          </Select>
        </>
      }
      pagination={{
        page,
        totalPages,
        onPageChange: setPage,
        pageSize,
        onPageSizeChange: handlePageSizeChange,
      }}
    />
  );
};

export default L2VPNCircuits;
