import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  AlertTriangle,
  TrendingDown,
  Clock,
  Activity,
  ArrowUpDown,
  Search,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowDown,
  ArrowUp,
  AlertCircle,
  Zap,
  BarChart3,
  Calendar,
  Users,
  UserX,
  Skull,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from "recharts";

import { PRODUCTION_URL } from "@/utils/Api";

interface StatusChange {
  id: string;
  customerType: string;
  interface: string;
  switchName: string;
  customerName: string;
  cid: string;
  nbr: string;
  previousStatus: string;
  newStatus: string;
  durationInPreviousState: number;
  changedAt: string;
  notes: string;
}

interface UnstableCustomer {
  interface: string;
  customerType: string;
  customerName: string;
  cid: string;
  nbr: string;
  switchName: string;
  changeCount: number;
  downCount: number;
  upCount: number;
  lastChange: string;
  avgDowntimeSec: number;
  avgDowntimeFormatted: string;
  stabilityScore: number;
}

interface ExtendedDowntime {
  interface: string;
  customerType: string;
  customerName: string;
  cid: string;
  nbr: string;
  switchName: string;
  downSince: string | null;
  downtimeSeconds: number | null;
  source: "tracked" | "untracked";
  downtimeFormatted: string;
  churnRisk: string;
}

interface ChurnSummary {
  period: string;
  summary: {
    totalChanges: number;
    uniqueCustomersAffected: number;
    changesByType: Array<{
      customerType: string;
      totalChanges: number;
      wentDown: number;
      cameUp: number;
    }>;
  };
  dailyTrend: Array<{
    date: string;
    changes: number;
    downs: number;
    ups: number;
  }>;
  mostAffectedNbrs: Array<{
    nbr: string;
    changeCount: number;
    uniqueCustomers: number;
  }>;
}

const COLORS = {
  DIA: "#3b82f6",
  IPT: "#8b5cf6",
  SHARED: "#06b6d4",
  L3VPN: "#10b981",
  FTTH: "#14b8a6",
  down: "#ef4444",
  up: "#22c55e",
  warning: "#f59e0b",
};

const RISK_COLORS = {
  low: "bg-green-500/20 text-green-400 border-green-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  churned: "bg-purple-500/20 text-purple-400 border-purple-500/30", // Customer likely cancelled
};

const PAGE_SIZE = 10;


export default function ChurnAnalysis() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  // Persist activeTab and riskFilter in localStorage
  const getInitialTab = () => localStorage.getItem("churn_activeTab") || "overview";
  const getInitialRisk = () => localStorage.getItem("churn_riskFilter") || null;
  const [activeTab, setActiveTab] = useState<string>(getInitialTab());
  const [timeRange, setTimeRange] = useState("30");
  const [customerTypeFilter, setCustomerTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [includeFtth, setIncludeFtth] = useState(
    () => localStorage.getItem("churn_includeFtth") === "1"
  );

  // Pagination states
  const [atRiskPage, setAtRiskPage] = useState(1);
  const [downtimePage, setDowntimePage] = useState(1);
  const [ftthDowntimePage, setFtthDowntimePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);

  // Risk filters
  const [riskFilter, setRiskFilter] = useState<string | null>(getInitialRisk());
  const [ftthRiskFilter, setFtthRiskFilter] = useState<string | null>(null);

  // Data states
  const [summary, setSummary] = useState<ChurnSummary | null>(null);
  const [unstableCustomers, setUnstableCustomers] = useState<UnstableCustomer[]>([]);
  const [extendedDowntime, setExtendedDowntime] = useState<ExtendedDowntime[]>([]);
  const [ftthDowntime, setFtthDowntime] = useState<ExtendedDowntime[]>([]);
  const [recentChanges, setRecentChanges] = useState<StatusChange[]>([]);
  const [patterns, setPatterns] = useState<any>(null);

  // Fetch all data
  const fetchData = async () => {
    setLoading(true);
    try {
      const typeParam = customerTypeFilter !== "all" ? `&customerType=${customerTypeFilter}` : "";
      const excludeFtthParam = includeFtth ? "" : "?excludeFtth=1";

      const [summaryRes, unstableRes, downtimeRes, changesRes, patternsRes] = await Promise.all([
        axios.get(`${PRODUCTION_URL}/churn-analysis/summary?days=${timeRange}`),
        axios.get(`${PRODUCTION_URL}/churn-analysis/unstable?days=${timeRange}&minChanges=3${typeParam}`),
        // Always fetch all types for downtime — split FTTH on the frontend
        axios.get(`${PRODUCTION_URL}/churn-analysis/extended-downtime${excludeFtthParam}`),
        axios.get(`${PRODUCTION_URL}/churn-analysis/changes?pageSize=50${typeParam}`),
        axios.get(`${PRODUCTION_URL}/churn-analysis/patterns?days=${timeRange}${typeParam}`),
      ]);

      const downtimeData = downtimeRes.data.data || {};
      const nonFtthDowntime: ExtendedDowntime[] = downtimeData.nonFtth?.results || [];
      const ftthOnlyDowntime: ExtendedDowntime[] = includeFtth
        ? downtimeData.ftth?.results || []
        : [];
      setSummary(summaryRes.data);
      setUnstableCustomers(unstableRes.data.data || []);
      setExtendedDowntime(nonFtthDowntime);
      setFtthDowntime(ftthOnlyDowntime);
      setRecentChanges(changesRes.data.data || []);
      setPatterns(patternsRes.data);
    } catch (error) {
      console.error("Error fetching churn data:", error);
      toast.error("Failed to fetch churn analysis data");
    } finally {
      setLoading(false);
    }
  };


  // Fetch data on mount and when timeRange or customerTypeFilter changes
  useEffect(() => {
    fetchData();
  }, [timeRange, customerTypeFilter, includeFtth]);

  // Auto-reload every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 120000); // 2 minutes
    return () => clearInterval(interval);
  }, [timeRange, customerTypeFilter, includeFtth, activeTab, riskFilter]);

  // Persist activeTab and riskFilter in localStorage
  useEffect(() => {
    localStorage.setItem("churn_activeTab", activeTab);
  }, [activeTab]);
  useEffect(() => {
    if (riskFilter) {
      localStorage.setItem("churn_riskFilter", riskFilter);
    } else {
      localStorage.removeItem("churn_riskFilter");
    }
  }, [riskFilter]);

  useEffect(() => {
    localStorage.setItem("churn_includeFtth", includeFtth ? "1" : "0");
    if (!includeFtth && activeTab === "ftth-downtime") {
      setActiveTab("downtime");
    }
  }, [includeFtth, activeTab]);

  // Navigate to customer view
  const handleViewCustomer = (customer: any) => {
    const routes: Record<string, string> = {
      DIA: "/viewcustomer",
      IPT: "/view-ipt-customer",
      SHARED: "/view-shared-customer",
      L3VPN: "/view-l3vpn-customer",
      FTTH: "/view-ftth-customer",
    };
    navigate(routes[customer.customerType] || "/viewcustomer", {
      state: { customer: { interface: customer.interface, ...customer } },
    });
  };


  // Reset pagination when data changes, but do not reset riskFilter if it was restored from storage
  useEffect(() => {
    setAtRiskPage(1);
    setDowntimePage(1);
    setFtthDowntimePage(1);
    setHistoryPage(1);
    // Only reset riskFilter if not set from storage
    if (!localStorage.getItem("churn_riskFilter")) setRiskFilter(null);
  }, [timeRange, customerTypeFilter, searchQuery]);

  // Reset downtime pages when risk filters change
  useEffect(() => {
    setDowntimePage(1);
  }, [riskFilter]);
  useEffect(() => {
    setFtthDowntimePage(1);
  }, [ftthRiskFilter]);

  // Filter unstable customers by search
  const filteredUnstable = useMemo(() => {
    if (!searchQuery) return unstableCustomers;
    const query = searchQuery.toLowerCase();
    return unstableCustomers.filter(
      (c) =>
        c.customerName?.toLowerCase().includes(query) ||
        c.interface?.toLowerCase().includes(query) ||
        c.nbr?.toLowerCase().includes(query) ||
        c.cid?.toLowerCase().includes(query)
    );
  }, [unstableCustomers, searchQuery]);

  // Paginated data for At Risk table
  const paginatedUnstable = useMemo(() => {
    const start = (atRiskPage - 1) * PAGE_SIZE;
    return filteredUnstable.slice(start, start + PAGE_SIZE);
  }, [filteredUnstable, atRiskPage]);

  const totalAtRiskPages = Math.ceil(filteredUnstable.length / PAGE_SIZE);

  // Filter Extended Downtime (non-FTTH) by search + risk level + type filter
  const filteredDowntime = useMemo(() => {
    let base = extendedDowntime;

    if (customerTypeFilter !== "all" && customerTypeFilter !== "FTTH") {
      base = base.filter((c) => c.customerType === customerTypeFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      base = base.filter(
        (c) =>
          c.customerName?.toLowerCase().includes(query) ||
          c.interface?.toLowerCase().includes(query) ||
          c.nbr?.toLowerCase().includes(query) ||
          c.cid?.toLowerCase().includes(query)
      );
    }

    if (!riskFilter) return base;
    return base.filter((c) => c.churnRisk === riskFilter);
  }, [extendedDowntime, riskFilter, searchQuery, customerTypeFilter]);

  // Filter FTTH Extended Downtime by search + risk level
  const filteredFtthDowntime = useMemo(() => {
    let base = ftthDowntime;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      base = base.filter(
        (c) =>
          c.customerName?.toLowerCase().includes(query) ||
          c.interface?.toLowerCase().includes(query)
      );
    }

    if (!ftthRiskFilter) return base;
    return base.filter((c) => c.churnRisk === ftthRiskFilter);
  }, [ftthDowntime, ftthRiskFilter, searchQuery]);

  // Export FTTH Extended Downtime (filtered) to CSV
  const handleExportFtthDowntime = () => {
    const data = filteredFtthDowntime;
    if (!data.length) {
      toast.info("No FTTH extended downtime data to export");
      return;
    }

    const headers = [
      "PPPoE Username",
      "IP Address",
      "Customer ID",
      "Home Number",
      "Down Since",
      "Duration",
      "Churn Risk",
      "Source",
    ];

    const escapeCsv = (value: any) => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (/[",\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const rows = data.map((c) => [
      c.customerName || "",
      c.interface || "",
      c.cid || "",
      c.nbr || "",
      c.downSince ? new Date(c.downSince).toLocaleString() : "Unknown",
      c.downtimeFormatted || "",
      c.churnRisk || "unknown",
      c.source || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `ftth_extended_downtime.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export Extended Downtime (filtered) to CSV/Excel
  const handleExportExtendedDowntime = () => {
    const data = filteredDowntime;
    if (!data.length) {
      toast.info("No extended downtime data to export");
      return;
    }

    const headers = [
      "Customer Name",
      "Interface",
      "Type",
      "NBR",
      "Switch",
      "Down Since",
      "Duration",
      "Churn Risk",
      "Source",
    ];

    const escapeCsv = (value: any) => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (/[",\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const rows = data.map((c) => [
      c.customerName || "",
      c.interface || "",
      c.customerType || "",
      c.nbr || "",
      c.switchName || "",
      c.downSince ? new Date(c.downSince).toLocaleString() : "Unknown",
      c.downtimeFormatted || "",
      c.churnRisk || "unknown",
      c.source || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `extended_downtime_${timeRange}d.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Paginated data for Extended Downtime table
  const paginatedDowntime = useMemo(() => {
    const start = (downtimePage - 1) * PAGE_SIZE;
    return filteredDowntime.slice(start, start + PAGE_SIZE);
  }, [filteredDowntime, downtimePage]);

  const totalDowntimePages = Math.ceil(filteredDowntime.length / PAGE_SIZE);

  // Paginated data for FTTH Extended Downtime table
  const paginatedFtthDowntime = useMemo(() => {
    const start = (ftthDowntimePage - 1) * PAGE_SIZE;
    return filteredFtthDowntime.slice(start, start + PAGE_SIZE);
  }, [filteredFtthDowntime, ftthDowntimePage]);

  const totalFtthDowntimePages = Math.ceil(filteredFtthDowntime.length / PAGE_SIZE);

  // Count customers by risk level for badge counts (non-FTTH)
  const riskCounts = useMemo(() => {
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0, churned: 0, unknown: 0 };
    filteredDowntime.forEach(c => {
      if (c.churnRisk && counts[c.churnRisk] !== undefined) counts[c.churnRisk]++;
    });
    return counts;
  }, [filteredDowntime]);

  // Count customers by risk level for badge counts (FTTH)
  const ftthRiskCounts = useMemo(() => {
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0, churned: 0, unknown: 0 };
    filteredFtthDowntime.forEach(c => {
      if (c.churnRisk && counts[c.churnRisk] !== undefined) counts[c.churnRisk]++;
    });
    return counts;
  }, [filteredFtthDowntime]);

  // Filter History table by search
  const filteredHistory = useMemo(() => {
    if (!searchQuery) return recentChanges;
    const query = searchQuery.toLowerCase();
    return recentChanges.filter(
      (c) =>
        c.customerName?.toLowerCase().includes(query) ||
        c.interface?.toLowerCase().includes(query) ||
        c.nbr?.toLowerCase().includes(query) ||
        c.cid?.toLowerCase().includes(query)
    );
  }, [recentChanges, searchQuery]);

  // Paginated data for History table
  const paginatedHistory = useMemo(() => {
    const start = (historyPage - 1) * PAGE_SIZE;
    return filteredHistory.slice(start, start + PAGE_SIZE);
  }, [filteredHistory, historyPage]);

  const totalHistoryPages = Math.ceil(filteredHistory.length / PAGE_SIZE);

  // Summary stats cards
  const statsCards = useMemo(() => {
    if (!summary?.summary) return [];
    return [
      {
        title: "Total Status Changes",
        value: summary.summary?.totalChanges ?? 0,
        icon: Activity,
        color: "text-blue-400",
        bgColor: "bg-blue-500/10",
      },
      {
        title: "Customers Affected",
        value: summary.summary?.uniqueCustomersAffected ?? 0,
        icon: Users,
        color: "text-purple-400",
        bgColor: "bg-purple-500/10",
      },
      {
        title: "Currently Down",
        value: extendedDowntime?.filter(c => c.churnRisk !== "churned")?.length ?? 0,
        icon: AlertTriangle,
        color: "text-red-400",
        bgColor: "bg-red-500/10",
      },
      {
        title: "Likely Churned",
        value: extendedDowntime?.filter(c => c.churnRisk === "churned")?.length ?? 0,
        icon: UserX,
        color: "text-purple-400",
        bgColor: "bg-purple-500/10",
        description: "Down > 2 weeks"
      },
    ];
  }, [summary, extendedDowntime, unstableCustomers]);

  // Get stability score color
  const getStabilityColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    if (score >= 40) return "text-orange-400";
    return "text-red-400";
  };

  // Get stability badge
  const getStabilityBadge = (score: number) => {
    if (score >= 80) return { label: "Stable", class: "bg-green-500/20 text-green-400" };
    if (score >= 60) return { label: "Fair", class: "bg-yellow-500/20 text-yellow-400" };
    if (score >= 40) return { label: "Unstable", class: "bg-orange-500/20 text-orange-400" };
    return { label: "Critical", class: "bg-red-500/20 text-red-400" };
  };

  // Pagination component
  const PaginationControls = ({
    currentPage,
    totalPages,
    totalItems,
    onPageChange,
  }: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    onPageChange: (page: number) => void;
  }) => {
    if (totalPages <= 1) return null;
    
    const startItem = (currentPage - 1) * PAGE_SIZE + 1;
    const endItem = Math.min(currentPage * PAGE_SIZE, totalItems);

    return (
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
        <div className="text-sm text-muted-foreground">
          Showing <span className="font-medium">{startItem}</span> to{" "}
          <span className="font-medium">{endItem}</span> of{" "}
          <span className="font-medium">{totalItems}</span> results
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? "default" : "outline"}
                  size="sm"
                  className="w-8 h-8 p-0"
                  onClick={() => onPageChange(pageNum)}
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const tabsClassName = includeFtth
    ? "grid w-full grid-cols-5 lg:w-[650px]"
    : "grid w-full grid-cols-4 lg:w-[520px]";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingDown className="h-6 w-6 text-red-400" />
            Churn Analysis
          </h1>
          <p className="text-muted-foreground mt-1">
            Track status changes and identify customers at risk of churning
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>

          <Select value={customerTypeFilter} onValueChange={setCustomerTypeFilter}>
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="DIA">DIA</SelectItem>
              <SelectItem value="IPT">IPT</SelectItem>
              <SelectItem value="SHARED">Shared</SelectItem>
              <SelectItem value="L3VPN">L3VPN</SelectItem>
              <SelectItem value="FTTH">FTTH</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2">
            <Switch checked={includeFtth} onCheckedChange={setIncludeFtth} />
            <span className="text-xs text-muted-foreground">Include FTTH</span>
          </div>

          {/* Global search across churn data */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers, interfaces, NBR or CID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat, i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value?.toLocaleString() || 0}</p>
                </div>
                <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className={tabsClassName}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="unstable">At Risk</TabsTrigger>
          <TabsTrigger value="downtime">Extended Down</TabsTrigger>
          {includeFtth && (
            <TabsTrigger value="ftth-downtime">FTTH Down</TabsTrigger>
          )}
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Daily Trend Chart */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-lg">Daily Status Changes</CardTitle>
                <CardDescription>Number of status transitions per day</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={summary?.dailyTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickFormatter={(val) => new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                        labelFormatter={(val) => new Date(val).toLocaleDateString()}
                      />
                      <Area
                        type="monotone"
                        dataKey="downs"
                        stackId="1"
                        stroke={COLORS.down}
                        fill={COLORS.down}
                        fillOpacity={0.6}
                        name="Went Down"
                      />
                      <Area
                        type="monotone"
                        dataKey="ups"
                        stackId="1"
                        stroke={COLORS.up}
                        fill={COLORS.up}
                        fillOpacity={0.6}
                        name="Came Up"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Changes by Type */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-lg">Changes by Customer Type</CardTitle>
                <CardDescription>Distribution of status changes</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary?.summary?.changesByType || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="customerType" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Bar dataKey="wentDown" name="Went Down" fill={COLORS.down} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cameUp" name="Came Up" fill={COLORS.up} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Hourly Pattern */}
            {patterns && (
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">Hourly Pattern</CardTitle>
                  <CardDescription>When do most outages occur?</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={patterns.hourlyPattern || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="hourFormatted" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Bar dataKey="downs" name="Outages" fill={COLORS.down} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Most Affected NBRs */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-lg">Most Affected Locations</CardTitle>
                <CardDescription>NBRs with highest status change frequency</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(summary?.mostAffectedNbrs || []).slice(0, 8).map((nbr, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-bold text-muted-foreground w-6">#{i + 1}</div>
                        <div>
                          <p className="font-medium">{nbr.nbr || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">
                            {nbr.uniqueCustomers} customers affected
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-red-400">
                        {nbr.changeCount} changes
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* At Risk (Unstable) Tab */}
        <TabsContent value="unstable" className="space-y-6 mt-6">
          <Card className="border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-400" />
                    Unstable Customers
                  </CardTitle>
                  <CardDescription>
                    Customers with frequent status changes (3+ changes in selected period)
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>NBR</TableHead>
                      <TableHead className="text-center">Changes</TableHead>
                      <TableHead className="text-center">Down Events</TableHead>
                      <TableHead>Avg Downtime</TableHead>
                      <TableHead>Stability</TableHead>
                      <TableHead>Last Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnstable.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          No unstable customers found in this period
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedUnstable.map((customer, i) => {
                        const stability = getStabilityBadge(customer.stabilityScore);
                        return (
                          <TableRow
                            key={i}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handleViewCustomer(customer)}
                          >
                            <TableCell>
                              <div>
                                <p className="font-medium">{customer.customerName || "Unknown"}</p>
                                <p className="text-xs text-muted-foreground">{customer.interface}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                style={{ borderColor: COLORS[customer.customerType as keyof typeof COLORS] }}
                              >
                                {customer.customerType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{customer.nbr || "-"}</TableCell>
                            <TableCell className="text-center">
                              <span className="font-bold text-yellow-400">{customer.changeCount}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="text-red-400">{customer.downCount}</span>
                            </TableCell>
                            <TableCell className="text-sm">{customer.avgDowntimeFormatted}</TableCell>
                            <TableCell>
                              <Badge className={stability.class}>{stability.label}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {new Date(customer.lastChange).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                <PaginationControls
                  currentPage={atRiskPage}
                  totalPages={totalAtRiskPages}
                  totalItems={filteredUnstable.length}
                  onPageChange={setAtRiskPage}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Extended Downtime Tab */}
        <TabsContent value="downtime" className="space-y-6 mt-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-red-400" />
                Extended Downtime - Churn Risk
              </CardTitle>
              <CardDescription className="space-y-3">
                <p>Customers currently down, sorted by duration. Click to filter by risk level:</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge 
                    className={`cursor-pointer transition-all ${RISK_COLORS.low} ${riskFilter === "low" ? "ring-2 ring-green-400 ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"}`}
                    onClick={() => setRiskFilter(riskFilter === "low" ? null : "low")}
                  >
                    LOW (&lt;1h) • {riskCounts.low}
                  </Badge>
                  <Badge 
                    className={`cursor-pointer transition-all ${RISK_COLORS.medium} ${riskFilter === "medium" ? "ring-2 ring-yellow-400 ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"}`}
                    onClick={() => setRiskFilter(riskFilter === "medium" ? null : "medium")}
                  >
                    MEDIUM (&lt;1d) • {riskCounts.medium}
                  </Badge>
                  <Badge 
                    className={`cursor-pointer transition-all ${RISK_COLORS.high} ${riskFilter === "high" ? "ring-2 ring-orange-400 ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"}`}
                    onClick={() => setRiskFilter(riskFilter === "high" ? null : "high")}
                  >
                    HIGH (&lt;3d) • {riskCounts.high}
                  </Badge>
                  <Badge 
                    className={`cursor-pointer transition-all ${RISK_COLORS.critical} ${riskFilter === "critical" ? "ring-2 ring-red-400 ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"}`}
                    onClick={() => setRiskFilter(riskFilter === "critical" ? null : "critical")}
                  >
                    CRITICAL (&lt;2w) • {riskCounts.critical}
                  </Badge>
                  <Badge 
                    className={`cursor-pointer transition-all ${RISK_COLORS.churned} ${riskFilter === "churned" ? "ring-2 ring-purple-400 ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"}`}
                    onClick={() => setRiskFilter(riskFilter === "churned" ? null : "churned")}
                  >
                    CHURNED (&gt;2w) • {riskCounts.churned}
                  </Badge>
                  {riskFilter && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-5 px-2 text-xs"
                      onClick={() => setRiskFilter(null)}
                    >
                      Clear filter ✕
                    </Button>
                  )}
                  {/* <div className="mt-2"> */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 px-2 text-xs py-4 ring-2 ring-purple-400 ring-offset-2 ring-offset-background "
                    onClick={handleExportExtendedDowntime}
                  >
                    Export Excel
                  </Button>
                {/* </div> */}
                </div>
                
                {riskFilter && (
                  <p className="text-sm font-medium">
                    Showing {filteredDowntime.length} customers with {riskFilter.toUpperCase()} risk
                  </p>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>NBR</TableHead>
                      <TableHead>Switch</TableHead>
                      <TableHead>Down Since</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Churn Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extendedDowntime.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No customers with extended downtime found
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedDowntime.map((customer, i) => (
                        <TableRow
                          key={i}
                          className={`cursor-pointer hover:bg-muted/50 ${customer.source === "untracked" ? "bg-orange-500/5" : ""}`}
                          onClick={() => handleViewCustomer(customer)}
                        >
                          <TableCell>
                            <div>
                              <p className="font-medium">{customer.customerName || "Unknown"}</p>
                              <p className="text-xs text-muted-foreground">{customer.interface}</p>
                              {customer.source === "untracked" && (
                                <Badge variant="outline" className="mt-1 text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/30">
                                  Before tracking
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              style={{ borderColor: COLORS[customer.customerType as keyof typeof COLORS] }}
                            >
                              {customer.customerType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{customer.nbr || "-"}</TableCell>
                          <TableCell className="text-sm">{customer.switchName || "-"}</TableCell>
                          <TableCell className="text-sm">
                            {customer.downSince 
                              ? new Date(customer.downSince).toLocaleString()
                              : <span className="text-orange-400 italic">Unknown</span>
                            }
                          </TableCell>
                          <TableCell>
                            <span className={`font-mono font-bold ${customer.source === "untracked" ? "text-orange-400" : "text-red-400"}`}>
                              {customer.downtimeFormatted}
                            </span>
                          </TableCell>
                          <TableCell>
                            {customer.churnRisk === "unknown" ? (
                              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                                UNKNOWN
                              </Badge>
                            ) : (
                              <Badge className={RISK_COLORS[customer.churnRisk as keyof typeof RISK_COLORS]}>
                                {customer.churnRisk.toUpperCase()}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <PaginationControls
                  currentPage={downtimePage}
                  totalPages={totalDowntimePages}
                  totalItems={filteredDowntime.length}
                  onPageChange={setDowntimePage}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FTTH Extended Downtime Tab */}
        {includeFtth && (
          <TabsContent value="ftth-downtime" className="space-y-6 mt-6">
            <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-teal-400" />
                FTTH Extended Downtime
              </CardTitle>
              <CardDescription className="space-y-3">
                <p>FTTH subscribers currently down. Click a badge to filter by risk level:</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {(["low", "medium", "high", "critical", "churned"] as const).map((level) => (
                    <Badge
                      key={level}
                      className={`cursor-pointer transition-all ${RISK_COLORS[level]} ${
                        ftthRiskFilter === level
                          ? "ring-2 ring-offset-2 ring-offset-background ring-current"
                          : "opacity-70 hover:opacity-100"
                      }`}
                      onClick={() => setFtthRiskFilter(ftthRiskFilter === level ? null : level)}
                    >
                      {level === "low" && "LOW (<1h)"}
                      {level === "medium" && "MEDIUM (<1d)"}
                      {level === "high" && "HIGH (<3d)"}
                      {level === "critical" && "CRITICAL (<2w)"}
                      {level === "churned" && "CHURNED (>2w)"}
                      {" • "}{ftthRiskCounts[level]}
                    </Badge>
                  ))}
                  {ftthRiskFilter && (
                    <Button variant="ghost" size="sm" className="h-5 px-2 text-xs" onClick={() => setFtthRiskFilter(null)}>
                      Clear filter ✕
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 px-2 text-xs py-4 ring-2 ring-teal-400 ring-offset-2 ring-offset-background"
                    onClick={handleExportFtthDowntime}
                  >
                    Export Excel
                  </Button>
                </div>
                {ftthRiskFilter && (
                  <p className="text-sm font-medium">
                    Showing {filteredFtthDowntime.length} FTTH customers with {ftthRiskFilter.toUpperCase()} risk
                  </p>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PPPoE Username</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Customer ID</TableHead>
                      <TableHead>Home Number</TableHead>
                      <TableHead>Down Since</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Churn Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ftthDowntime.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No FTTH customers with extended downtime found
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedFtthDowntime.map((customer, i) => (
                        <TableRow
                          key={i}
                          className={`cursor-pointer hover:bg-muted/50 ${
                            customer.source === "untracked" ? "bg-orange-500/5" : ""
                          }`}
                          onClick={() => handleViewCustomer(customer)}
                        >
                          <TableCell>
                            <div>
                              <p className="font-medium font-mono text-sm">{customer.customerName || "Unknown"}</p>
                              {customer.source === "untracked" && (
                                <Badge variant="outline" className="mt-1 text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/30">
                                  Before tracking
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-teal-400">{customer.interface || "-"}</TableCell>
                          <TableCell className="text-sm">{customer.cid || "-"}</TableCell>
                          <TableCell className="text-sm">{customer.nbr || "-"}</TableCell>
                          <TableCell className="text-sm">
                            {customer.downSince
                              ? new Date(customer.downSince).toLocaleString()
                              : <span className="text-orange-400 italic">Unknown</span>
                            }
                          </TableCell>
                          <TableCell>
                            <span className={`font-mono font-bold ${
                              customer.source === "untracked" ? "text-orange-400" : "text-red-400"
                            }`}>
                              {customer.downtimeFormatted}
                            </span>
                          </TableCell>
                          <TableCell>
                            {customer.churnRisk === "unknown" ? (
                              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">UNKNOWN</Badge>
                            ) : (
                              <Badge className={RISK_COLORS[customer.churnRisk as keyof typeof RISK_COLORS]}>
                                {customer.churnRisk.toUpperCase()}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <PaginationControls
                  currentPage={ftthDowntimePage}
                  totalPages={totalFtthDowntimePages}
                  totalItems={filteredFtthDowntime.length}
                  onPageChange={setFtthDowntimePage}
                />
              </div>
            </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* History Tab */}
        <TabsContent value="history" className="space-y-6 mt-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-400" />
                Recent Status Changes
              </CardTitle>
              <CardDescription>Latest status transitions across all customers</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Duration in Previous</TableHead>
                      <TableHead>NBR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentChanges.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No recent status changes recorded
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedHistory.map((change, i) => (
                        <TableRow
                          key={i}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleViewCustomer(change)}
                        >
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(change.changedAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{change.customerName || "Unknown"}</p>
                              <p className="text-xs text-muted-foreground">{change.interface}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              style={{ borderColor: COLORS[change.customerType as keyof typeof COLORS] }}
                            >
                              {change.customerType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  change.previousStatus === "up"
                                    ? "bg-green-500/20 text-green-400"
                                    : "bg-red-500/20 text-red-400"
                                }
                              >
                                {change.previousStatus}
                              </Badge>
                              <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                              <Badge
                                variant="outline"
                                className={
                                  change.newStatus === "up"
                                    ? "bg-green-500/20 text-green-400"
                                    : "bg-red-500/20 text-red-400"
                                }
                              >
                                {change.newStatus}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {change.durationInPreviousState
                              ? formatDuration(change.durationInPreviousState)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-sm">{change.nbr || "-"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <PaginationControls
                  currentPage={historyPage}
                  totalPages={totalHistoryPages}
                  totalItems={recentChanges.length}
                  onPageChange={setHistoryPage}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper function for formatting duration
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

