import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  FileSpreadsheet, 
  Download, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw,
  Database,
  Zap
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";

interface AggregateData {
  count: number;
  successCount: number;
  totalP95Combined: number;
  avgP95Combined: number;
  maxP95Combined: number;
  hasData: boolean;
}

interface AggregatedReport {
  month: string;
  aggregates: {
    IPT: AggregateData;
    DIA: AggregateData;
    GPON: AggregateData;
  };
  overall: {
    totalCustomers: number;
    totalP95Combined: number;
    avgP95Combined: number;
  };
  missing: string[];
  isComplete: boolean;
}

interface CheckResult {
  month: string;
  IPT: { exists: boolean; count: number };
  DIA: { exists: boolean; count: number };
  GPON: { exists: boolean; count: number };
  missing: string[];
}

const formatBytes = (bps: number): string => {
  if (bps >= 1_000_000_000) {
    return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  } else if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  } else if (bps >= 1_000) {
    return `${(bps / 1_000).toFixed(2)} Kbps`;
  }
  return `${bps.toFixed(2)} bps`;
};

const CombinedPercentileReport = () => {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [aggregatedData, setAggregatedData] = useState<AggregatedReport | null>(null);
  const [availableMonths, setAvailableMonths] = useState<{ month: string; count: number }[]>([]);
  const [generatingType, setGeneratingType] = useState<string | null>(null);

  // Generate month options (last 12 months)
  const monthOptions = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      months.push({ value, label });
    }
    return months;
  }, []);

  // Fetch available months from database
  const fetchAvailableMonths = async () => {
    try {
      const res = await axios.get(`${PRODUCTION_URL}/percentile-reports/months`);
      setAvailableMonths(res.data.months || []);
    } catch (err) {
      console.error("Error fetching available months:", err);
    }
  };

  useEffect(() => {
    fetchAvailableMonths();
  }, []);

  // Check what reports exist for selected month
  const checkReports = async () => {
    if (!selectedMonth) return;

    setLoading(true);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/percentile-reports/check/${selectedMonth}`);
      setCheckResult(res.data);

      // Also fetch aggregated data if any exists
      if (res.data.IPT.exists || res.data.DIA.exists || res.data.GPON.exists) {
        const aggRes = await axios.get(`${PRODUCTION_URL}/percentile-reports/aggregated/${selectedMonth}`);
        setAggregatedData(aggRes.data);
      } else {
        setAggregatedData(null);
      }
    } catch (err) {
      console.error("Error checking reports:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedMonth) {
      checkReports();
    }
  }, [selectedMonth]);

  // Navigate to generate missing report
  const generateMissingReport = (type: string) => {
    const routes: Record<string, string> = {
      IPT: "/ipt-report",
      DIA: "/dia-report",
      GPON: "/gpon-report",
    };
    navigate(routes[type], { state: { selectedMonth } });
  };

  // Export combined report
  const exportReport = () => {
    if (!aggregatedData) return;

    const monthLabel = monthOptions.find((m) => m.value === selectedMonth)?.label || selectedMonth;
    const reportData = {
      title: "Combined 95th Percentile Report",
      month: monthLabel,
      generatedAt: new Date().toISOString(),
      summary: {
        totalCustomers: aggregatedData.overall.totalCustomers,
        totalP95Combined: formatBytes(aggregatedData.overall.totalP95Combined),
        avgP95Combined: formatBytes(aggregatedData.overall.avgP95Combined),
      },
      byType: {
        IPT: {
          customers: aggregatedData.aggregates.IPT.successCount,
          totalP95: formatBytes(aggregatedData.aggregates.IPT.totalP95Combined),
          avgP95: formatBytes(aggregatedData.aggregates.IPT.avgP95Combined),
          maxP95: formatBytes(aggregatedData.aggregates.IPT.maxP95Combined),
        },
        DIA: {
          customers: aggregatedData.aggregates.DIA.successCount,
          totalP95: formatBytes(aggregatedData.aggregates.DIA.totalP95Combined),
          avgP95: formatBytes(aggregatedData.aggregates.DIA.avgP95Combined),
          maxP95: formatBytes(aggregatedData.aggregates.DIA.maxP95Combined),
        },
        GPON: {
          customers: aggregatedData.aggregates.GPON.successCount,
          totalP95: formatBytes(aggregatedData.aggregates.GPON.totalP95Combined),
          avgP95: formatBytes(aggregatedData.aggregates.GPON.avgP95Combined),
          maxP95: formatBytes(aggregatedData.aggregates.GPON.maxP95Combined),
        },
      },
      isComplete: aggregatedData.isComplete,
      missing: aggregatedData.missing,
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `combined-95th-percentile-${selectedMonth}.json`;
    a.click();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Database className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Combined 95th Percentile Report</h1>
            <p className="text-muted-foreground">
              Aggregated billing report for IPT, DIA, and GPON
            </p>
          </div>
        </div>
      </div>

      {/* Month Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Select Month</CardTitle>
          <CardDescription>
            Choose a month to view or generate the combined 95th percentile report
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">Month</label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => {
                    const dbMonth = availableMonths.find((am) => am.month === m.value);
                    return (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label} {dbMonth && <span className="text-green-500 ml-1">({dbMonth.count})</span>}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              onClick={checkReports}
              disabled={!selectedMonth || loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </Button>

            {aggregatedData && (
              <Button variant="outline" onClick={exportReport}>
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report Status */}
      {checkResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Report Status for {monthOptions.find((m) => m.value === selectedMonth)?.label}
              {checkResult.missing.length === 0 ? (
                <Badge className="bg-green-500/20 text-green-400">Complete</Badge>
              ) : (
                <Badge className="bg-yellow-500/20 text-yellow-400">Incomplete</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* IPT Status */}
              <Card className={`border ${checkResult.IPT.exists ? "border-green-500/50 bg-green-500/5" : "border-yellow-500/50 bg-yellow-500/5"}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">IPT Customers</p>
                      <p className="text-2xl font-bold">{checkResult.IPT.count}</p>
                    </div>
                    {checkResult.IPT.exists ? (
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    ) : (
                      <Button
                        size="sm"
                        className="bg-yellow-500 hover:bg-yellow-600"
                        onClick={() => generateMissingReport("IPT")}
                      >
                        <Zap className="h-4 w-4 mr-1" />
                        Generate
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* DIA Status */}
              <Card className={`border ${checkResult.DIA.exists ? "border-green-500/50 bg-green-500/5" : "border-yellow-500/50 bg-yellow-500/5"}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">DIA Customers</p>
                      <p className="text-2xl font-bold">{checkResult.DIA.count}</p>
                    </div>
                    {checkResult.DIA.exists ? (
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    ) : (
                      <Button
                        size="sm"
                        className="bg-yellow-500 hover:bg-yellow-600"
                        onClick={() => generateMissingReport("DIA")}
                      >
                        <Zap className="h-4 w-4 mr-1" />
                        Generate
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* GPON Status */}
              <Card className={`border ${checkResult.GPON.exists ? "border-green-500/50 bg-green-500/5" : "border-yellow-500/50 bg-yellow-500/5"}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">GPON</p>
                      <p className="text-2xl font-bold">{checkResult.GPON.count}</p>
                    </div>
                    {checkResult.GPON.exists ? (
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    ) : (
                      <Button
                        size="sm"
                        className="bg-yellow-500 hover:bg-yellow-600"
                        onClick={() => generateMissingReport("GPON")}
                      >
                        <Zap className="h-4 w-4 mr-1" />
                        Generate
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aggregated Results */}
      {aggregatedData && (
        <div className="space-y-6">
          {/* Overall Summary */}
          <Card className="border-emerald-500/50 bg-gradient-to-br from-emerald-500/10 to-teal-500/10">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-emerald-300 mb-2">Combined 95th Percentile (All Types)</p>
                <p className="text-5xl font-bold text-emerald-400">
                  {formatBytes(aggregatedData.overall.totalP95Combined)}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Total from {aggregatedData.overall.totalCustomers} customers/services
                </p>
                <p className="text-lg text-gray-400 mt-1">
                  Average: {formatBytes(aggregatedData.overall.avgP95Combined)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Breakdown by Type */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* IPT */}
            <Card className="border-yellow-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-yellow-400">IPT</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customers:</span>
                    <span className="font-bold">{aggregatedData.aggregates.IPT.successCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total 95th:</span>
                    <span className="font-bold text-yellow-400">{formatBytes(aggregatedData.aggregates.IPT.totalP95Combined)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Average:</span>
                    <span>{formatBytes(aggregatedData.aggregates.IPT.avgP95Combined)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max:</span>
                    <span>{formatBytes(aggregatedData.aggregates.IPT.maxP95Combined)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* DIA */}
            <Card className="border-blue-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-blue-400">DIA</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customers:</span>
                    <span className="font-bold">{aggregatedData.aggregates.DIA.successCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total 95th:</span>
                    <span className="font-bold text-blue-400">{formatBytes(aggregatedData.aggregates.DIA.totalP95Combined)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Average:</span>
                    <span>{formatBytes(aggregatedData.aggregates.DIA.avgP95Combined)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max:</span>
                    <span>{formatBytes(aggregatedData.aggregates.DIA.maxP95Combined)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* GPON */}
            <Card className="border-purple-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-purple-400">GPON</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Services:</span>
                    <span className="font-bold">{aggregatedData.aggregates.GPON.successCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total 95th:</span>
                    <span className="font-bold text-purple-400">{formatBytes(aggregatedData.aggregates.GPON.totalP95Combined)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Average:</span>
                    <span>{formatBytes(aggregatedData.aggregates.GPON.avgP95Combined)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max:</span>
                    <span>{formatBytes(aggregatedData.aggregates.GPON.maxP95Combined)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Warning if incomplete */}
          {!aggregatedData.isComplete && (
            <Card className="border-yellow-500/50 bg-yellow-500/10">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3 text-yellow-400">
                  <AlertCircle className="h-5 w-5" />
                  <div>
                    <p className="font-medium">Report Incomplete</p>
                    <p className="text-sm text-muted-foreground">
                      Missing data for: {aggregatedData.missing.join(", ")}. 
                      Generate the missing reports to get complete aggregated data.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* No Data Message */}
      {checkResult && !aggregatedData && (
        <Card className="border-gray-500/50">
          <CardContent className="py-12 text-center">
            <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No Reports Generated Yet</p>
            <p className="text-muted-foreground mb-4">
              Generate IPT, DIA, or GPON reports for this month to see aggregated data
            </p>
            <div className="flex justify-center gap-2">
              <Button onClick={() => generateMissingReport("IPT")}>Generate IPT</Button>
              <Button onClick={() => generateMissingReport("DIA")}>Generate DIA</Button>
              <Button onClick={() => generateMissingReport("GPON")}>Generate GPON</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CombinedPercentileReport;

