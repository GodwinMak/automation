import React, { useState, useEffect } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ReusableTable } from "@/components/Table";
import { Progress } from "@/components/ui/progress";
import {
  Network,
  Globe,
  Share2,
  Router,
  HardDrive,
  Users,
  TrendingUp,
  BarChart3,
  Zap,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

interface CapacityStats {
  dia: { capacity: number; customers: number; up: number; down: number; upCapacity: number; downCapacity: number };
  ipt: { capacity: number; customers: number; up: number; down: number; upCapacity: number; downCapacity: number };
  shared: { capacity: number; customers: number; up: number; down: number; upCapacity: number; downCapacity: number };
  l3vpn: { capacity: number; customers: number; up: number; down: number; upCapacity: number; downCapacity: number };
  total: { capacity: number; customers: number; switches: number; up: number; down: number; upCapacity: number; downCapacity: number };
}

interface SwitchCapacity {
  nbr: string;
  dia_capacity: number;
  dia_customers: number;
  dia_up_capacity: number;
  dia_up_count: number;
  dia_down_capacity: number;
  dia_down_count: number;
  ipt_capacity: number;
  ipt_customers: number;
  ipt_up_capacity: number;
  ipt_up_count: number;
  ipt_down_capacity: number;
  ipt_down_count: number;
  shared_capacity: number;
  shared_customers: number;
  shared_up_capacity: number;
  shared_up_count: number;
  shared_down_capacity: number;
  shared_down_count: number;
  l3vpn_capacity: number;
  l3vpn_customers: number;
  l3vpn_up_capacity: number;
  l3vpn_up_count: number;
  l3vpn_down_capacity: number;
  l3vpn_down_count: number;
  total_capacity: number;
  total_customers: number;
  total_up_capacity: number;
  total_up_count: number;
  total_down_capacity: number;
  total_down_count: number;
}

const Capacity = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<CapacityStats | null>(null);
  const [switchData, setSwitchData] = useState<SwitchCapacity[]>([]);
  const [topSwitches, setTopSwitches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");

  // Fetch capacity stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get(`${PRODUCTION_URL}/capacity/stats`);
        setStats(res.data);
      } catch (error) {
        console.error("Error fetching capacity stats:", error);
      }
    };
    fetchStats();
  }, []);

  // Fetch top switches
  useEffect(() => {
    const fetchTopSwitches = async () => {
      try {
        const res = await axios.get(`${PRODUCTION_URL}/capacity/top?limit=5`);
        setTopSwitches(res.data.data || []);
      } catch (error) {
        console.error("Error fetching top switches:", error);
      }
    };
    fetchTopSwitches();
  }, []);

  // Fetch switch capacity data
  useEffect(() => {
    const fetchSwitchData = async () => {
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/capacity?page=${page}&pageSize=${pageSize}&search=${search}&sortBy=total_capacity&sortOrder=desc`
        );
        setSwitchData(res.data.data || []);
        setTotalPages(res.data.totalPages || 1);
      } catch (error) {
        console.error("Error fetching switch data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchSwitchData();
  }, [page, pageSize, search]);

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setPage(1);
  };

  const formatCapacity = (mbps: number) => {
    if (mbps >= 1000) {
      return `${(mbps / 1000).toFixed(2)} Gbps`;
    }
    return `${mbps} Mbps`;
  };

  // Calculate percentages for the pie chart representation
  const getPercentage = (value: number, total: number) => {
    if (total === 0) return 0;
    return ((value / total) * 100).toFixed(1);
  };

  const columns = [
    { key: "nbr", label: "Switch Name" },
    {
      key: "total_capacity",
      label: "Total Capacity",
      render: (row: SwitchCapacity) => (
        <div className="flex flex-col gap-1">
          <span className="font-bold text-primary">
            {formatCapacity(row.total_capacity)}
          </span>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-success">↑{formatCapacity(row.total_up_capacity)} ({row.total_up_count})</span>
            <span className="text-destructive">↓{formatCapacity(row.total_down_capacity)} ({row.total_down_count})</span>
          </div>
        </div>
      ),
    },
    {
      key: "dia_capacity",
      label: "DIA",
      render: (row: SwitchCapacity) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Network className="h-3 w-3 text-blue-500" />
            <span className="font-medium">{formatCapacity(row.dia_capacity)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-success">↑{formatCapacity(row.dia_up_capacity)} ({row.dia_up_count})</span>
            <span className="text-destructive">↓{formatCapacity(row.dia_down_capacity)} ({row.dia_down_count})</span>
          </div>
        </div>
      ),
    },
    {
      key: "ipt_capacity",
      label: "IPT",
      render: (row: SwitchCapacity) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Globe className="h-3 w-3 text-purple-500" />
            <span className="font-medium">{formatCapacity(row.ipt_capacity)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-success">↑{formatCapacity(row.ipt_up_capacity)} ({row.ipt_up_count})</span>
            <span className="text-destructive">↓{formatCapacity(row.ipt_down_capacity)} ({row.ipt_down_count})</span>
          </div>
        </div>
      ),
    },
    {
      key: "shared_capacity",
      label: "Shared",
      render: (row: SwitchCapacity) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Share2 className="h-3 w-3 text-orange-500" />
            <span className="font-medium">{formatCapacity(row.shared_capacity)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-success">↑{formatCapacity(row.shared_up_capacity)} ({row.shared_up_count})</span>
            <span className="text-destructive">↓{formatCapacity(row.shared_down_capacity)} ({row.shared_down_count})</span>
          </div>
        </div>
      ),
    },
    {
      key: "l3vpn_capacity",
      label: "L3VPN",
      render: (row: SwitchCapacity) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Router className="h-3 w-3 text-cyan-500" />
            <span className="font-medium">{formatCapacity(row.l3vpn_capacity)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-success">↑{formatCapacity(row.l3vpn_up_capacity)} ({row.l3vpn_up_count})</span>
            <span className="text-destructive">↓{formatCapacity(row.l3vpn_down_capacity)} ({row.l3vpn_down_count})</span>
          </div>
        </div>
      ),
    },
  ];

  const Action = (row: SwitchCapacity) => (
    <>
      <DropdownMenuItem
        onClick={() => navigate("/dia-customer", { state: { nbr: row.nbr } })}
      >
        <Network className="h-4 w-4 mr-2 text-blue-500" />
        View DIA Customers
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => navigate("/ipt-customer", { state: { nbr: row.nbr } })}
      >
        <Globe className="h-4 w-4 mr-2 text-purple-500" />
        View IPT Customers
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => navigate("/shared-customer", { state: { nbr: row.nbr } })}
      >
        <Share2 className="h-4 w-4 mr-2 text-orange-500" />
        View Shared Customers
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => navigate("/l3vpn-customer", { state: { nbr: row.nbr } })}
      >
        <Router className="h-4 w-4 mr-2 text-cyan-500" />
        View L3VPN Customers
      </DropdownMenuItem>
    </>
  );

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-primary" />
          Capacity Dashboard
        </h1>
        <p className="text-muted-foreground">
          Monitor network capacity utilization across all customer types and switches.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Total Capacity */}
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Total Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              {stats ? formatCapacity(stats.total.capacity) : "..."}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="p-2 rounded-lg bg-success/10 border border-success/20">
                <div className="flex items-center gap-1 mb-1">
                  <ArrowUpCircle className="h-3 w-3 text-success" />
                  <span className="text-xs text-success font-medium">UP</span>
                </div>
                <div className="text-sm font-bold text-success">
                  {stats ? formatCapacity(stats.total.upCapacity) : "..."}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats?.total.up || 0} customers
                </div>
              </div>
              <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-center gap-1 mb-1">
                  <ArrowDownCircle className="h-3 w-3 text-destructive" />
                  <span className="text-xs text-destructive font-medium">DOWN</span>
                </div>
                <div className="text-sm font-bold text-destructive">
                  {stats ? formatCapacity(stats.total.downCapacity) : "..."}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats?.total.down || 0} customers
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* DIA Capacity */}
        <Card className="border-blue-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Network className="h-4 w-4 text-blue-500" />
              DIA Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">
              {stats ? formatCapacity(stats.dia.capacity) : "..."}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-1.5 rounded bg-success/10">
                <div className="flex items-center gap-1">
                  <ArrowUpCircle className="h-3 w-3 text-success" />
                  <span className="text-xs font-medium text-success">
                    {stats ? formatCapacity(stats.dia.upCapacity) : "..."}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{stats?.dia.up || 0} up</div>
              </div>
              <div className="p-1.5 rounded bg-destructive/10">
                <div className="flex items-center gap-1">
                  <ArrowDownCircle className="h-3 w-3 text-destructive" />
                  <span className="text-xs font-medium text-destructive">
                    {stats ? formatCapacity(stats.dia.downCapacity) : "..."}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{stats?.dia.down || 0} down</div>
              </div>
            </div>
            <Progress
              value={
                stats
                  ? Number(getPercentage(stats.dia.capacity, stats.total.capacity))
                  : 0
              }
              className="mt-2 h-2"
            />
          </CardContent>
        </Card>

        {/* IPT Capacity */}
        <Card className="border-purple-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Globe className="h-4 w-4 text-purple-500" />
              IPT Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-500">
              {stats ? formatCapacity(stats.ipt.capacity) : "..."}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-1.5 rounded bg-success/10">
                <div className="flex items-center gap-1">
                  <ArrowUpCircle className="h-3 w-3 text-success" />
                  <span className="text-xs font-medium text-success">
                    {stats ? formatCapacity(stats.ipt.upCapacity) : "..."}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{stats?.ipt.up || 0} up</div>
              </div>
              <div className="p-1.5 rounded bg-destructive/10">
                <div className="flex items-center gap-1">
                  <ArrowDownCircle className="h-3 w-3 text-destructive" />
                  <span className="text-xs font-medium text-destructive">
                    {stats ? formatCapacity(stats.ipt.downCapacity) : "..."}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{stats?.ipt.down || 0} down</div>
              </div>
            </div>
            <Progress
              value={
                stats
                  ? Number(getPercentage(stats.ipt.capacity, stats.total.capacity))
                  : 0
              }
              className="mt-2 h-2"
            />
          </CardContent>
        </Card>

        {/* Shared Capacity */}
        <Card className="border-orange-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Share2 className="h-4 w-4 text-orange-500" />
              Shared Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">
              {stats ? formatCapacity(stats.shared.capacity) : "..."}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-1.5 rounded bg-success/10">
                <div className="flex items-center gap-1">
                  <ArrowUpCircle className="h-3 w-3 text-success" />
                  <span className="text-xs font-medium text-success">
                    {stats ? formatCapacity(stats.shared.upCapacity) : "..."}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{stats?.shared.up || 0} up</div>
              </div>
              <div className="p-1.5 rounded bg-destructive/10">
                <div className="flex items-center gap-1">
                  <ArrowDownCircle className="h-3 w-3 text-destructive" />
                  <span className="text-xs font-medium text-destructive">
                    {stats ? formatCapacity(stats.shared.downCapacity) : "..."}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{stats?.shared.down || 0} down</div>
              </div>
            </div>
            <Progress
              value={
                stats
                  ? Number(getPercentage(stats.shared.capacity, stats.total.capacity))
                  : 0
              }
              className="mt-2 h-2"
            />
          </CardContent>
        </Card>

        {/* L3VPN Capacity */}
        <Card className="border-cyan-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Router className="h-4 w-4 text-cyan-500" />
              L3VPN Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-500">
              {stats ? formatCapacity(stats.l3vpn.capacity) : "..."}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-1.5 rounded bg-success/10">
                <div className="flex items-center gap-1">
                  <ArrowUpCircle className="h-3 w-3 text-success" />
                  <span className="text-xs font-medium text-success">
                    {stats ? formatCapacity(stats.l3vpn.upCapacity) : "..."}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{stats?.l3vpn.up || 0} up</div>
              </div>
              <div className="p-1.5 rounded bg-destructive/10">
                <div className="flex items-center gap-1">
                  <ArrowDownCircle className="h-3 w-3 text-destructive" />
                  <span className="text-xs font-medium text-destructive">
                    {stats ? formatCapacity(stats.l3vpn.downCapacity) : "..."}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{stats?.l3vpn.down || 0} down</div>
              </div>
            </div>
            <Progress
              value={
                stats
                  ? Number(getPercentage(stats.l3vpn.capacity, stats.total.capacity))
                  : 0
              }
              className="mt-2 h-2"
            />
          </CardContent>
        </Card>
      </div>

      {/* Top Switches & Capacity Distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Switches by Capacity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Top Switches by Capacity
            </CardTitle>
            <CardDescription>
              Switches with highest capacity utilization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topSwitches.length > 0 ? (
                topSwitches.map((sw, index) => (
                  <div
                    key={`${sw.nbr}-${index}`}
                    className="flex items-center gap-4"
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{sw.nbr}</span>
                        <span
                          className={`px-1.5 py-0.5 text-xs rounded ${
                            sw.type === "DIA"
                              ? "bg-blue-500/10 text-blue-500"
                              : sw.type === "IPT"
                              ? "bg-purple-500/10 text-purple-500"
                              : sw.type === "L3VPN"
                              ? "bg-cyan-500/10 text-cyan-500"
                              : "bg-orange-500/10 text-orange-500"
                          }`}
                        >
                          {sw.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Progress
                          value={
                            stats
                              ? (parseInt(sw.capacity) / stats.total.capacity) * 100
                              : 0
                          }
                          className="h-2 flex-1"
                        />
                        <span className="text-sm text-muted-foreground min-w-fit">
                          {formatCapacity(parseInt(sw.capacity) || 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-center py-4">
                  No data available
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Capacity Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              Capacity Distribution
            </CardTitle>
            <CardDescription>
              Breakdown by service type
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* DIA */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="font-medium">DIA</span>
                  </div>
                  <span className="text-muted-foreground">
                    {stats
                      ? `${getPercentage(stats.dia.capacity, stats.total.capacity)}%`
                      : "..."}
                  </span>
                </div>
                <div className="h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{
                      width: stats
                        ? `${getPercentage(stats.dia.capacity, stats.total.capacity)}%`
                        : "0%",
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{stats ? formatCapacity(stats.dia.capacity) : "..."}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-success">↑{stats ? formatCapacity(stats.dia.upCapacity) : "..."} ({stats?.dia.up || 0})</span>
                    <span className="text-destructive">↓{stats ? formatCapacity(stats.dia.downCapacity) : "..."} ({stats?.dia.down || 0})</span>
                  </div>
                </div>
              </div>

              {/* IPT */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-purple-500" />
                    <span className="font-medium">IPT</span>
                  </div>
                  <span className="text-muted-foreground">
                    {stats
                      ? `${getPercentage(stats.ipt.capacity, stats.total.capacity)}%`
                      : "..."}
                  </span>
                </div>
                <div className="h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all duration-500"
                    style={{
                      width: stats
                        ? `${getPercentage(stats.ipt.capacity, stats.total.capacity)}%`
                        : "0%",
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{stats ? formatCapacity(stats.ipt.capacity) : "..."}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-success">↑{stats ? formatCapacity(stats.ipt.upCapacity) : "..."} ({stats?.ipt.up || 0})</span>
                    <span className="text-destructive">↓{stats ? formatCapacity(stats.ipt.downCapacity) : "..."} ({stats?.ipt.down || 0})</span>
                  </div>
                </div>
              </div>

              {/* Shared */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-orange-500" />
                    <span className="font-medium">Shared</span>
                  </div>
                  <span className="text-muted-foreground">
                    {stats
                      ? `${getPercentage(stats.shared.capacity, stats.total.capacity)}%`
                      : "..."}
                  </span>
                </div>
                <div className="h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-orange-500 transition-all duration-500"
                    style={{
                      width: stats
                        ? `${getPercentage(stats.shared.capacity, stats.total.capacity)}%`
                        : "0%",
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{stats ? formatCapacity(stats.shared.capacity) : "..."}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-success">↑{stats ? formatCapacity(stats.shared.upCapacity) : "..."} ({stats?.shared.up || 0})</span>
                    <span className="text-destructive">↓{stats ? formatCapacity(stats.shared.downCapacity) : "..."} ({stats?.shared.down || 0})</span>
                  </div>
                </div>
              </div>

              {/* L3VPN */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-cyan-500" />
                    <span className="font-medium">L3VPN</span>
                  </div>
                  <span className="text-muted-foreground">
                    {stats
                      ? `${getPercentage(stats.l3vpn.capacity, stats.total.capacity)}%`
                      : "..."}
                  </span>
                </div>
                <div className="h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 transition-all duration-500"
                    style={{
                      width: stats
                        ? `${getPercentage(stats.l3vpn.capacity, stats.total.capacity)}%`
                        : "0%",
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{stats ? formatCapacity(stats.l3vpn.capacity) : "..."}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-success">↑{stats ? formatCapacity(stats.l3vpn.upCapacity) : "..."} ({stats?.l3vpn.up || 0})</span>
                    <span className="text-destructive">↓{stats ? formatCapacity(stats.l3vpn.downCapacity) : "..."} ({stats?.l3vpn.down || 0})</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Switch Capacity Table */}
      <ReusableTable
        title="Switch Capacity Breakdown"
        description="Detailed capacity per switch across all service types"
        columns={columns}
        data={switchData}
        actions={Action}
        loading={loading}
        headerActions={
          <input
            type="text"
            placeholder="Search switch..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="border border-border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary bg-background text-foreground"
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

export default Capacity;

