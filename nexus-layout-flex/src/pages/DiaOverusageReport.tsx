import React, { useEffect, useState } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { ReusableTable } from "@/components/Table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Network, RefreshCw, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";

type DiaOverusageItem = {
  id: string;
  customerName: string;
  interfaceName: string;
  upmbps: number | null;
  downmbps: number | null;
  maxUploadBps: number;
  maxDownloadBps: number;
  maxUpload: string;
  maxDownload: string;
  overUploadSamples: number;
  overDownloadSamples: number;
  totalUploadSamples: number;
  totalDownloadSamples: number;
  cid: string | null;
  nbr: string | null;
  port: string | null;
};

const DiaOverusageReport: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<DiaOverusageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Load latest stored report from the database on page load
  useEffect(() => {
    const fetchLatest = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await axios.get(`${PRODUCTION_URL}/dia-overusage`);
        const items = (res.data.data || []).map((item: any) => ({
          id: item.id || item.interfaceName,
          customerName: item.customerName,
          interfaceName: item.interfaceName,
          upmbps: item.upmbps,
          downmbps: item.downmbps,
          maxUploadBps: item.maxUploadBps,
          maxDownloadBps: item.maxDownloadBps,
          maxUpload: item.maxUpload,
          maxDownload: item.maxDownload,
          overUploadSamples: item.overUploadSamples,
          overDownloadSamples: item.overDownloadSamples,
          totalUploadSamples: item.totalUploadSamples,
          totalDownloadSamples: item.totalDownloadSamples,
          cid: item.cid,
          nbr: item.nbr,
          port: item.port,
        }));
        setData(items);
        setPage(1);

        if (res.data.data && res.data.data.length > 0) {
          const latestRun = res.data.data[0].runAt || res.data.data[0].createdAt;
          if (latestRun) {
            setLastRun(new Date(latestRun));
          }
        }
      } catch (err: any) {
        console.error("Error fetching latest DIA over-usage report:", err);
        // Don't block the page if cached fetch fails
      } finally {
        setLoading(false);
      }
    };

    fetchLatest();
  }, []);

  // Ensure current page stays within bounds when data or page size changes
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [data.length, pageSize, page]);

  const runReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/dia-overusage/run`);
      const items = (res.data.data || []).map((item: any, index: number) => ({
        id: item.interfaceName || index.toString(),
        ...item,
      }));
      setData(items);
      setLastRun(new Date());
      setPage(1);
    } catch (err: any) {
      console.error("Error running DIA over-usage report:", err);
      setError(
        err.response?.data?.message ||
          "Failed to run DIA over-usage report. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      key: "customerName" as const,
      label: "Customer",
      render: (row: DiaOverusageItem) => (
        <button
          type="button"
          className="text-primary hover:underline text-left"
          onClick={() =>
            navigate("/viewcustomer", {
              state: {
                fromOverusage: true,
                interface: row.interfaceName,
              },
            })
          }
        >
          {row.customerName}
        </button>
      ),
    },
    { key: "interfaceName" as const, label: "Interface" },
    {
      key: "upmbps" as const,
      label: "Capacity (Up/Down)",
      render: (row: DiaOverusageItem) => (
        <span>
          {row.upmbps ?? "-"} / {row.downmbps ?? "-"} Mbps
        </span>
      ),
    },
    {
      key: "maxUpload" as const,
      label: "Max Traffic (Up/Down)",
      render: (row: DiaOverusageItem) => (
        <div className="flex flex-col text-xs">
          <span className="text-success">↑ {row.maxUpload}</span>
          <span className="text-destructive">↓ {row.maxDownload}</span>
        </div>
      ),
    },
    {
      key: "overUploadSamples" as const,
      label: ">130% Samples (Up/Down)",
      render: (row: DiaOverusageItem) => (
        <div className="flex flex-col text-xs">
          <span className="text-success">
            ↑ {row.overUploadSamples}/{row.totalUploadSamples}
          </span>
          <span className="text-destructive">
            ↓ {row.overDownloadSamples}/{row.totalDownloadSamples}
          </span>
        </div>
      ),
    },
    {
      key: "nbr" as const,
      label: "NBR / Port / CID",
      render: (row: DiaOverusageItem) => (
        <div className="flex flex-col text-xs">
          <span>{row.nbr || "-"}</span>
          <span>{row.port || "-"}</span>
          <span>{row.cid || "-"}</span>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Network className="h-8 w-8 text-primary" />
          DIA Over-Usage Report
        </h1>
        <p className="text-muted-foreground">
          Run a 24-hour analysis against Zabbix graphs to find DIA customers whose
          traffic exceeds 130% of their configured upload/download capacity.
        </p>
      </div>

      <Card className="border-primary/20">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-base font-medium">Run Report</CardTitle>
            <CardDescription>
              This will query Zabbix for all DIA customers for the last 24 hours.
            </CardDescription>
          </div>
          <Button onClick={runReport} disabled={loading} variant="default">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" /> Run DIA Over-Usage
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {lastRun && (
            <p className="text-xs text-muted-foreground">
              Last run: {lastRun.toLocaleString()}
            </p>
          )}
          {data.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Customers with over-usage: {data.length}
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Slice data for client-side pagination */}
      <ReusableTable
        title="DIA Over-Usage Results"
        description="List of DIA customers whose traffic exceeded 130% of their configured capacity in the last 24 hours."
        data={data.slice((page - 1) * pageSize, page * pageSize)}
        columns={columns}
        loading={loading}
        pagination={{
          page,
          totalPages: Math.max(1, Math.ceil(data.length / pageSize)),
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: setPageSize,
        }}
      />
    </div>
  );
};

export default DiaOverusageReport;
