import React, { useEffect, useState } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, FileText, AlertTriangle, Activity, WifiOff, Eye, X } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Report {
  id: string;
  reportDate: string;
  totalExpiredChecked: number;
  aliveWhileExpiredCount: number;
  notInInfoCount: number;
  createdAt: string;
}

interface ReportCustomers {
  reportDate: string;
  aliveWhileExpired: Record<string, string>[];
  notInChurnReport: Record<string, string>[];
}

type ActiveTab = "alive" | "notInInfo";

const FTTHReports = () => {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  // View modal state
  const [viewReport, setViewReport] = useState<Report | null>(null);
  const [customers, setCustomers] = useState<ReportCustomers | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("alive");

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await axios.get(`${PRODUCTION_URL}/ftth-reports`, { withCredentials: true });
        setReports(res.data.reports || []);
      } catch (err) {
        console.error("Failed to fetch FTTH reports:", err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  const handleView = async (report: Report) => {
    setViewReport(report);
    setCustomers(null);
    setActiveTab("alive");
    setLoadingCustomers(true);
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/ftth-reports/${report.id}/customers`,
        { withCredentials: true }
      );
      setCustomers(res.data);
    } catch (err) {
      console.error("Failed to fetch report customers:", err);
    } finally {
      setLoadingCustomers(false);
    }
  };

  const handleDownload = async (report: Report) => {
    setDownloading(report.id);
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/ftth-reports/${report.id}/download`,
        { responseType: "arraybuffer", withCredentials: true }
      );
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `FTTH_Report_${report.reportDate}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(null);
    }
  };

  const latest = reports[0] ?? null;

  // Chart data — last 30 reports, oldest first so X axis reads left-to-right
  const chartData = [...reports]
    .slice(0, 30)
    .reverse()
    .map((r) => ({
      date: r.reportDate,
      "Alive While Expired": r.aliveWhileExpiredCount,
      "Not in Churn Report": r.notInInfoCount,
    }));

  const totalAlive = reports.reduce((s, r) => s + r.aliveWhileExpiredCount, 0);
  const totalNotInInfo = reports.reduce((s, r) => s + r.notInInfoCount, 0);
  const avgExpiredChecked =
    reports.length > 0
      ? Math.round(reports.reduce((s, r) => s + r.totalExpiredChecked, 0) / reports.length)
      : 0;

  const statCards = [
    {
      label: "Reports Available",
      value: reports.length,
      icon: <FileText className="h-5 w-5 text-blue-500" />,
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "Total Alive While Expired",
      value: totalAlive,
      icon: <Activity className="h-5 w-5 text-orange-500" />,
      color: "text-orange-600 dark:text-orange-400",
      sub: latest ? `Latest: ${latest.aliveWhileExpiredCount}` : undefined,
    },
    {
      label: "Total Not in Churn Report",
      value: totalNotInInfo,
      icon: <AlertTriangle className="h-5 w-5 text-yellow-500" />,
      color: "text-yellow-600 dark:text-yellow-400",
      sub: latest ? `Latest: ${latest.notInInfoCount}` : undefined,
    },
    {
      label: "Avg Expired Checked / Day",
      value: avgExpiredChecked,
      icon: <WifiOff className="h-5 w-5 text-red-500" />,
      color: "text-red-600 dark:text-red-400",
      sub: latest ? `Latest: ${latest.totalExpiredChecked}` : undefined,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">FTTH Daily Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Updated every hour, one report per day — reports auto-expire after 90 days.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map(({ label, value, icon, color, sub }) => (
              <Card key={label} className="border border-border">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3 mb-2">
                    {icon}
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                  <p className={`text-3xl font-bold ${color}`}>{value}</p>
                  {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <Card className="border border-border">
              <CardHeader>
                <CardTitle className="text-base">
                  30-Day Trend — Alive While Expired &amp; Not in Churn Report
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d) => d.slice(5)} // show MM-DD
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    />
                    <Legend />
                    <Bar dataKey="Alive While Expired" fill="#f97316" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Not in Churn Report" fill="#eab308" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Report Table */}
          <Card className="border border-border">
            <CardHeader>
              <CardTitle className="text-base">All Reports</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {reports.length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 py-8 text-center">
                  No reports yet. Reports are generated automatically each morning at 06:00.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Date</th>
                        <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Expired Checked</th>
                        <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Alive While Expired</th>
                        <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Not in Churn Report</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map((r, i) => (
                        <tr
                          key={r.id}
                          className={`border-b border-border/50 ${i % 2 === 0 ? "" : "bg-muted/20"}`}
                        >
                          <td className="px-4 py-3 font-medium text-foreground">{r.reportDate}</td>
                          <td className="px-4 py-3 text-right text-foreground">{r.totalExpiredChecked}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={r.aliveWhileExpiredCount > 0 ? "text-orange-500 font-semibold" : "text-muted-foreground"}>
                              {r.aliveWhileExpiredCount}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={r.notInInfoCount > 0 ? "text-yellow-500 font-semibold" : "text-muted-foreground"}>
                              {r.notInInfoCount}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 h-7 text-xs"
                                onClick={() => handleView(r)}
                              >
                                <Eye className="h-3 w-3" />
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 h-7 text-xs"
                                disabled={downloading === r.id}
                                onClick={() => handleDownload(r)}
                              >
                                {downloading === r.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                                Download
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* View Customers Modal */}
      {viewReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Flagged Customers — {viewReport.reportDate}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Expired checked: {viewReport.totalExpiredChecked} &nbsp;·&nbsp;
                  Alive: {viewReport.aliveWhileExpiredCount} &nbsp;·&nbsp;
                  Not in churn: {viewReport.notInInfoCount}
                </p>
              </div>
              <button
                onClick={() => setViewReport(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
              <button
                onClick={() => setActiveTab("alive")}
                className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === "alive"
                    ? "border-orange-500 text-orange-600 dark:text-orange-400"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Alive While Expired
                {customers && (
                  <span className="ml-1.5 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-full">
                    {customers.aliveWhileExpired.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("notInInfo")}
                className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === "notInInfo"
                    ? "border-yellow-500 text-yellow-600 dark:text-yellow-400"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Not in Churn Report
                {customers && (
                  <span className="ml-1.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded-full">
                    {customers.notInChurnReport.length}
                  </span>
                )}
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto flex-1">
              {loadingCustomers ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !customers ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  Failed to load customers.
                </p>
              ) : activeTab === "alive" ? (
                customers.aliveWhileExpired.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    No customers were alive while expired on this day.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Customer ID</th>
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Customer Name</th>
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">PPPoE Username</th>
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">IP Address</th>
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Top-Up Expiry</th>
                        <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Times Found Today</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.aliveWhileExpired.map((row, i) => (
                        <tr key={i} className={`border-b border-border/50 ${i % 2 !== 0 ? "bg-muted/20" : ""}`}>
                          <td className="px-4 py-2.5 text-foreground">{row["Customer ID"] || "—"}</td>
                          <td className="px-4 py-2.5 text-foreground">{row["Customer Name"] || "—"}</td>
                          <td className="px-4 py-2.5 text-foreground font-mono text-xs">{row["PPPoE Username"] || "—"}</td>
                          <td className="px-4 py-2.5 text-foreground font-mono text-xs">{row["IP Address"] || "—"}</td>
                          <td className="px-4 py-2.5 text-orange-500">{row["Top-Up Expiry"] || "—"}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-orange-500">{row["Times Found Alive Today"] ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                customers.notInChurnReport.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    All customers were present in the churn report on this day.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Customer ID</th>
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Customer Name</th>
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">PPPoE Username</th>
                        <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">IP Address</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.notInChurnReport.map((row, i) => (
                        <tr key={i} className={`border-b border-border/50 ${i % 2 !== 0 ? "bg-muted/20" : ""}`}>
                          <td className="px-4 py-2.5 text-foreground">{row["Customer ID"] || "—"}</td>
                          <td className="px-4 py-2.5 text-foreground">{row["Customer Name"] || "—"}</td>
                          <td className="px-4 py-2.5 text-foreground font-mono text-xs">{row["PPPoE Username"] || "—"}</td>
                          <td className="px-4 py-2.5 text-foreground font-mono text-xs">{row["IP Address"] || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FTTHReports;
