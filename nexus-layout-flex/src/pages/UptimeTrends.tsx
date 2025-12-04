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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  Clock,
  Calendar,
  CalendarDays,
  Network,
  Globe,
  Share2,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  BarChart3,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
} from "recharts";

interface SummaryStats {
  today: { DIA: string; IPT: string; Shared: string; ALL: string };
  weekly: { DIA: string; IPT: string; Shared: string; ALL: string };
  monthly: { DIA: string; IPT: string; Shared: string; ALL: string };
}

interface TrendData {
  date: string;
  avgUptime: number;
  avgUp: number;
  avgDown: number;
  avgTotal: number;
  avgUpCapacity: number;
  avgTotalCapacity: number;
}

const UptimeTrends = () => {
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [weeklyData, setWeeklyData] = useState<TrendData[]>([]);
  const [monthlyData, setMonthlyData] = useState<TrendData[]>([]);
  const [comparisonData, setComparisonData] = useState<any[]>([]);
  const [selectedType, setSelectedType] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch summary stats
  useEffect(() => {
    fetchSummary();
    fetchWeeklyData();
    fetchMonthlyData();
    fetchComparison();
  }, []);

  useEffect(() => {
    fetchWeeklyData();
    fetchMonthlyData();
  }, [selectedType]);

  const fetchSummary = async () => {
    try {
      const res = await axios.get(`${PRODUCTION_URL}/uptime-history/summary`);
      setSummary(res.data);
    } catch (error) {
      console.error("Error fetching summary:", error);
    }
  };

  const fetchWeeklyData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/uptime-history/weekly?type=${selectedType}`
      );
      setWeeklyData(res.data.data || []);
    } catch (error) {
      console.error("Error fetching weekly data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMonthlyData = async () => {
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/uptime-history/monthly?type=${selectedType}`
      );
      setMonthlyData(res.data.data || []);
    } catch (error) {
      console.error("Error fetching monthly data:", error);
    }
  };

  const fetchComparison = async () => {
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/uptime-history/comparison?period=monthly`
      );
      setComparisonData(res.data.data || []);
    } catch (error) {
      console.error("Error fetching comparison:", error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await axios.post(`${PRODUCTION_URL}/uptime-history/snapshot`);
      await fetchSummary();
      await fetchWeeklyData();
      await fetchMonthlyData();
      await fetchComparison();
    } catch (error) {
      console.error("Error refreshing:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "DIA":
        return "#3b82f6"; // blue
      case "IPT":
        return "#8b5cf6"; // purple
      case "Shared":
        return "#f97316"; // orange
      default:
        return "#22c55e"; // green
    }
  };

  const getUptimeColor = (uptime: number) => {
    if (uptime >= 99) return "text-success";
    if (uptime >= 95) return "text-yellow-500";
    return "text-destructive";
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-primary" />
            Uptime Trends
          </h1>
          <p className="text-muted-foreground">
            Monitor network uptime history and trends over time.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Services</SelectItem>
              <SelectItem value="DIA">DIA Only</SelectItem>
              <SelectItem value="IPT">IPT Only</SelectItem>
              <SelectItem value="Shared">Shared Only</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Today */}
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Today's Uptime
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">All Services</span>
                <span className={`text-2xl font-bold ${getUptimeColor(parseFloat(summary?.today?.ALL || "0"))}`}>
                  {summary?.today?.ALL || "0"}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="flex flex-col items-center p-2 rounded bg-blue-500/10">
                  <span className="text-blue-500 font-semibold">{summary?.today?.DIA || "0"}%</span>
                  <span className="text-xs text-muted-foreground">DIA</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded bg-purple-500/10">
                  <span className="text-purple-500 font-semibold">{summary?.today?.IPT || "0"}%</span>
                  <span className="text-xs text-muted-foreground">IPT</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded bg-orange-500/10">
                  <span className="text-orange-500 font-semibold">{summary?.today?.Shared || "0"}%</span>
                  <span className="text-xs text-muted-foreground">Shared</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Weekly */}
        <Card className="border-success/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Weekly Average
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">All Services</span>
                <span className={`text-2xl font-bold ${getUptimeColor(parseFloat(summary?.weekly?.ALL || "0"))}`}>
                  {summary?.weekly?.ALL || "0"}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="flex flex-col items-center p-2 rounded bg-blue-500/10">
                  <span className="text-blue-500 font-semibold">{summary?.weekly?.DIA || "0"}%</span>
                  <span className="text-xs text-muted-foreground">DIA</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded bg-purple-500/10">
                  <span className="text-purple-500 font-semibold">{summary?.weekly?.IPT || "0"}%</span>
                  <span className="text-xs text-muted-foreground">IPT</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded bg-orange-500/10">
                  <span className="text-orange-500 font-semibold">{summary?.weekly?.Shared || "0"}%</span>
                  <span className="text-xs text-muted-foreground">Shared</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Monthly */}
        <Card className="border-yellow-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Monthly Average
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">All Services</span>
                <span className={`text-2xl font-bold ${getUptimeColor(parseFloat(summary?.monthly?.ALL || "0"))}`}>
                  {summary?.monthly?.ALL || "0"}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="flex flex-col items-center p-2 rounded bg-blue-500/10">
                  <span className="text-blue-500 font-semibold">{summary?.monthly?.DIA || "0"}%</span>
                  <span className="text-xs text-muted-foreground">DIA</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded bg-purple-500/10">
                  <span className="text-purple-500 font-semibold">{summary?.monthly?.IPT || "0"}%</span>
                  <span className="text-xs text-muted-foreground">IPT</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded bg-orange-500/10">
                  <span className="text-orange-500 font-semibold">{summary?.monthly?.Shared || "0"}%</span>
                  <span className="text-xs text-muted-foreground">Shared</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="weekly" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="weekly" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Weekly Trend
          </TabsTrigger>
          <TabsTrigger value="monthly" className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Monthly Trend
          </TabsTrigger>
          <TabsTrigger value="comparison" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Type Comparison
          </TabsTrigger>
        </TabsList>

        {/* Weekly Chart */}
        <TabsContent value="weekly">
          <Card>
            <CardHeader>
              <CardTitle>Weekly Uptime Trend - {selectedType}</CardTitle>
              <CardDescription>
                Daily average uptime percentage over the last 7 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              {weeklyData.length > 0 ? (
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weeklyData}>
                      <defs>
                        <linearGradient id="uptimeGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={getTypeColor(selectedType)} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={getTypeColor(selectedType)} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDate}
                        className="text-xs"
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        className="text-xs"
                      />
                      <Tooltip
                        formatter={(value: any) => [`${parseFloat(value).toFixed(2)}%`, "Uptime"]}
                        labelFormatter={(label) => formatDate(label)}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="avgUptime"
                        stroke={getTypeColor(selectedType)}
                        fill="url(#uptimeGradient)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                  <p>No data available. Data will be collected hourly.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monthly Chart */}
        <TabsContent value="monthly">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Uptime Trend - {selectedType}</CardTitle>
              <CardDescription>
                Daily average uptime percentage over the last 30 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              {monthlyData.length > 0 ? (
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDate}
                        className="text-xs"
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        className="text-xs"
                      />
                      <Tooltip
                        formatter={(value: any) => [`${parseFloat(value).toFixed(2)}%`, "Uptime"]}
                        labelFormatter={(label) => formatDate(label)}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="avgUptime"
                        name="Uptime %"
                        stroke={getTypeColor(selectedType)}
                        strokeWidth={2}
                        dot={{ fill: getTypeColor(selectedType), strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                  <p>No data available. Data will be collected hourly.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Comparison Chart */}
        <TabsContent value="comparison">
          <Card>
            <CardHeader>
              <CardTitle>Service Type Comparison</CardTitle>
              <CardDescription>
                Compare uptime performance across DIA, IPT, and Shared services
              </CardDescription>
            </CardHeader>
            <CardContent>
              {comparisonData.length > 0 ? (
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <YAxis type="category" dataKey="customerType" width={80} />
                      <Tooltip
                        formatter={(value: any, name: string) => [
                          `${parseFloat(value).toFixed(2)}%`,
                          name === "avgUptime" ? "Avg Uptime" : name,
                        ]}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Bar
                        dataKey="avgUptime"
                        name="Average Uptime"
                        fill="#22c55e"
                        radius={[0, 4, 4, 0]}
                      />
                      <Bar
                        dataKey="minUptime"
                        name="Min Uptime"
                        fill="#ef4444"
                        radius={[0, 4, 4, 0]}
                      />
                      <Bar
                        dataKey="maxUptime"
                        name="Max Uptime"
                        fill="#3b82f6"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                  <p>No data available. Data will be collected hourly.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Customer Counts Trend */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5 text-success" />
              Weekly UP/DOWN Trend
            </CardTitle>
            <CardDescription>
              Customer count trends over the last 7 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyData}>
                    <defs>
                      <linearGradient id="upGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="downGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tickFormatter={formatDate} className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      labelFormatter={(label) => formatDate(label)}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="avgUp"
                      name="UP"
                      stroke="#22c55e"
                      fill="url(#upGradient)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="avgDown"
                      name="DOWN"
                      stroke="#ef4444"
                      fill="url(#downGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <p>No data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Capacity Trend
            </CardTitle>
            <CardDescription>
              UP capacity trend over the last 7 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tickFormatter={formatDate} className="text-xs" />
                    <YAxis
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}G`}
                      className="text-xs"
                    />
                    <Tooltip
                      formatter={(value: any) => [
                        `${(parseFloat(value) / 1000).toFixed(2)} Gbps`,
                        "Capacity",
                      ]}
                      labelFormatter={(label) => formatDate(label)}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                    <Bar
                      dataKey="avgUpCapacity"
                      name="UP Capacity"
                      fill="#22c55e"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <p>No data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default UptimeTrends;

