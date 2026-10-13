import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { ReusableTable } from "@/components/Table";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Eye, Upload, Loader2, Download, Zap, WifiOff } from "lucide-react";
import { PRODUCTION_URL } from "@/utils/Api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SwitchDetail {
  switch: string;
  sessionsFound: string[];
  sessionsCleared: string[];
  errors: { interface: string | null; error: string }[];
}

interface ClearResult {
  message: string;
  pppoeusername?: string;
  totalCleared: number;
  details: SwitchDetail[] | { pppoeusername: string; switches: SwitchDetail[] }[];
}

interface BulkClearResult {
  // ipv4Result: ClearResult | null;
  ipv6Result: ClearResult | null;
  // ipv4Error: string | null;
  ipv6Error: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

const FTTHCustomer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state: locationState } = location;

  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(20);

  // Upload state (PPPoE Excel)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Churn report upload state
  const churnFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingChurn, setUploadingChurn] = useState(false);
  const [churnUploadResult, setChurnUploadResult] = useState<any>(null);
  const [churnUploadError, setChurnUploadError] = useState<string | null>(null);
  const [isChurnModalOpen, setIsChurnModalOpen] = useState(false);

  // ── Bulk clear state ──────────────────────────────────────────────────────
  const [isBulkClearing, setIsBulkClearing] = useState(false);
  const [bulkClearResult, setBulkClearResult] = useState<BulkClearResult | null>(null);
  const [isBulkClearModalOpen, setIsBulkClearModalOpen] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // ── Per-row clear state ───────────────────────────────────────────────────
  const [clearingUsername, setClearingUsername] = useState<string | null>(null);
  const [rowClearResult, setRowClearResult] = useState<ClearResult | null>(null);
  const [rowClearError, setRowClearError] = useState<string | null>(null);
  const [isRowClearModalOpen, setIsRowClearModalOpen] = useState(false);

  const initialFilter =
    locationState?.filterType === "up" || locationState?.filterType === "down"
      ? locationState.filterType
      : "all";
  const [statusFilter, setStatusFilter] = useState(initialFilter);

  const initialExpiry =
    locationState?.expiryFilter === "expired" || locationState?.expiryFilter === "active"
      ? locationState.expiryFilter
      : "all";
  const [expiryFilter, setExpiryFilter] = useState(initialExpiry);
  const [withinDays, setWithinDays] = useState("");
  const [ipVersionFilter, setIpVersionFilter] = useState("all");
  const [freeFilter, setFreeFilter] = useState(
    locationState?.freeFilter === "free" || locationState?.freeFilter === "nonfree"
      ? locationState.freeFilter
      : "all"
  );
  const [exporting, setExporting] = useState(false);

  const buildQuery = () => {
    const base = `search=${search}&status=${statusFilter}&expiry=${expiryFilter}`;
    const wd = withinDays ? `&withinDays=${withinDays}` : "";
    const ipv = ipVersionFilter !== "all" ? `&ip_version=${ipVersionFilter}` : "";
    const free = freeFilter !== "all" ? `&freeStatus=${freeFilter}` : "";
    return base + wd + ipv + free;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/ftthcustomers/export?${buildQuery()}`,
        { responseType: "arraybuffer", withCredentials: true }
      );
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `FTTH_Subscribers_${new Date().toISOString().split("T")[0]}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/ftthcustomers?page=${page}&pageSize=${pageSize}&${buildQuery()}`
        );
        setCustomers(res.data.customers || []);
        setTotalPages(res.data.totalPages);
      } catch (err) {
        console.error("Error fetching FTTH customers:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCustomers();
  }, [page, search, pageSize, statusFilter, expiryFilter, withinDays, ipVersionFilter, freeFilter]);

  const handlePageSizeChange = (value: number) => {
    setPageSize(value);
    setPage(1);
  };

  // ── Upload handlers ───────────────────────────────────────────────────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setUploadResult(null);
    setUploadError(null);
    setIsUploadModalOpen(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/ftthcustomers/upload`, formData, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUploadResult(res.data);
      setPage(1);
    } catch (err: any) {
      setUploadError(err?.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleChurnUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadingChurn(true);
    setChurnUploadResult(null);
    setChurnUploadError(null);
    setIsChurnModalOpen(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/ftthcustomers/upload-churn`, formData, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });
      setChurnUploadResult(res.data);
      setPage(1);
    } catch (err: any) {
      setChurnUploadError(err?.response?.data?.message || "Churn upload failed");
    } finally {
      setUploadingChurn(false);
    }
  };

  // ── Bulk clear handler ────────────────────────────────────────────────────
  // Fires both endpoints in parallel:
  //   POST /ftthcustomers/clear-sessions/ipv4-expired   → clears expired IPv4 (not free)
  //   POST /ftthcustomers/clear-sessions/ipv6-active    → clears non-expired IPv6 (so they re-dial and get IPv4)

  const handleBulkClear = async () => {
    setShowBulkConfirm(false);
    setIsBulkClearing(true);
    setBulkClearResult(null);
    setIsBulkClearModalOpen(true);

    const [ipv6Res] = await Promise.allSettled([
      //  axios.post(
      //   `${PRODUCTION_URL}/clear-pppoe-session/clear-all-ipv4-expired-not-free`,
      //   {},
      //   { withCredentials: true }
      // ),
      // axios.post(
      //   `${PRODUCTION_URL}/clear-pppoe-session/clear-all-ipv6-not-expired`,
      //   {},
      //   { withCredentials: true }
      // ),
      axios.post(
        `${PRODUCTION_URL}/clear-pppoe-session/clear-all-ipv6-expired`,
        {},
        { withCredentials: true }
      ),
    ]);

    setBulkClearResult({
      // ipv4Result: ipv4Res.status === "fulfilled" ? ipv4Res.value.data : null,
      ipv6Result: ipv6Res.status === "fulfilled" ? ipv6Res.value.data : null,
      // ipv4Error:
      //   ipv4Res.status === "rejected"
      //     ? ipv4Res.reason?.response?.data?.error || "IPv4 clear failed"
      //     : null,
      ipv6Error:
        ipv6Res.status === "rejected"
          ? ipv6Res.reason?.response?.data?.error || "IPv6 clear failed"
          : null,
    });

    setIsBulkClearing(false);
  };

  // ── Per-row clear handler ─────────────────────────────────────────────────

  const handleClearSpecific = async (pppoeusername: string) => {
    setClearingUsername(pppoeusername);
    setRowClearResult(null);
    setRowClearError(null);
    setIsRowClearModalOpen(true);

    try {
      const res = await axios.post(
        `${PRODUCTION_URL}/clear-pppoe-session/clear-specific`,
        { pppoeusername },
        { withCredentials: true }
      );
      setRowClearResult(res.data);
    } catch (err: any) {
      setRowClearError(err?.response?.data?.error || "Failed to clear session");
    } finally {
      setClearingUsername(null);
    }
  };

  // ── Renderers ─────────────────────────────────────────────────────────────

  const expiryRenderer = (customer: any) => {
    const expiry = customer.topUpExpiry;
    if (!expiry)
      return <span className="text-muted-foreground text-xs italic">Not available</span>;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiryDate = new Date(expiry);
    expiryDate.setHours(0, 0, 0, 0);
    const diffMs = expiryDate.getTime() - today.getTime();
    const diffDays = Math.round(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
    if (diffMs === 0)
      return <span className="text-yellow-500 font-medium text-xs">Expires today</span>;
    if (diffMs > 0)
      return (
        <span className="text-green-600 dark:text-green-400 font-medium text-xs">
          {diffDays}d remaining
        </span>
      );
    return <span className="text-red-500 font-medium text-xs">Expired {diffDays}d ago</span>;
  };

  const columns = [
    { key: "customerID", label: "Customer ID" },
    { key: "customerName", label: "Customer Name" },
    { key: "pppoeusername", label: "PPPoE Username" },
    { key: "ip", label: "IP Address" },
    { key: "ip_version", label: "IP Version" },
    { key: "homeNumber", label: "Home Number" },
    { key: "status", label: "Status" },
    { key: "topUpExpiry", label: "Expiry", render: expiryRenderer },
    {key: "isFreeCustomer", label: "Free Customer", render: (c: any) => c.isFreeCustomer ? "Yes" : "No" },
  ];

  const Action = (customer: any) => (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => navigate("/view-ftth-customer", { state: { customer } })}
      >
        <Eye className="h-4 w-4" />
        View Customer
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2 text-orange-500 focus:text-orange-500"
        disabled={clearingUsername === customer.pppoeusername}
        onClick={() => handleClearSpecific(customer.pppoeusername)}
      >
        {clearingUsername === customer.pppoeusername ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <WifiOff className="h-4 w-4" />
        )}
        {clearingUsername === customer.pppoeusername ? "Clearing..." : "Clear PPPoE Session"}
      </DropdownMenuItem>
    </>
  );

  // ─── Bulk clear result summary ────────────────────────────────────────────

  const BulkResultPanel = ({
    label,
    result,
    error,
    color,
  }: {
    label: string;
    result: ClearResult | null;
    error: string | null;
    color: string;
  }) => (
    <div className={`rounded-xl border p-4 space-y-2 ${color}`}>
      <p className="font-semibold text-sm">{label}</p>
      {error ? (
        <p className="text-red-500 text-sm">{error}</p>
      ) : result ? (
        <>
          <p className="text-xs text-muted-foreground">{result.message}</p>
          <p className="text-2xl font-bold">{result.totalCleared}</p>
          <p className="text-xs text-muted-foreground">sessions cleared</p>
          {/* Per-switch breakdown */}
          {result.details?.length > 0 && (
            <div className="space-y-1 mt-2">
              {(result.details as any[]).map((d: any, i: number) => {
                // Details can be flat SwitchDetail or { pppoeusername, switches[] }
                const switches: SwitchDetail[] = d.switches ?? [d];
                return switches.map((sw, j) => (
                  <div key={`${i}-${j}`} className="text-xs flex justify-between">
                    <span className="text-muted-foreground">{sw.switch}</span>
                    <span className="font-medium">{sw.sessionsCleared.length} cleared</span>
                  </div>
                ));
              })}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground italic">No data</p>
      )}
    </div>
  );

  return (
    <div className="p-6">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleUpload}
      />
      <input
        ref={churnFileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleChurnUpload}
      />

      <ReusableTable
        title="FTTH Subscribers"
        description="Manage FTTH PPPoE subscribers"
        columns={columns}
        data={customers}
        actions={Action}
        loading={loading}
        filters={
          <>
            <label className="mr-2 font-medium">Status:</label>
            <Select
              value={statusFilter}
              onValueChange={(value) => { setStatusFilter(value); setPage(1); }}
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

            <label className="mr-2 font-medium">Expiry:</label>
            <Select
              value={expiryFilter}
              onValueChange={(value) => { setExpiryFilter(value); setPage(1); }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter Expiry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Not Expired</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="expiredOver">Expired Over N Days</SelectItem>
                <SelectItem value="unavailable">Not Available</SelectItem>
              </SelectContent>
            </Select>

            <label className="mr-2 font-medium">IP Version:</label>
            <Select
              value={ipVersionFilter}
              onValueChange={(value) => { setIpVersionFilter(value); setPage(1); }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="IP Version" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="IPv4">IPv4</SelectItem>
                <SelectItem value="IPv6">IPv6</SelectItem>
              </SelectContent>
            </Select>

            <label className="mr-2 font-medium">Free Customer:</label>
            <Select
              value={freeFilter}
              onValueChange={(value) => { setFreeFilter(value); setPage(1); }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Free Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="nonfree">Non-Free</SelectItem>
              </SelectContent>
            </Select>

            <input
              type="number"
              min="1"
              disabled={expiryFilter === "unavailable"}
              placeholder={
                expiryFilter === "expired"
                  ? "Expired last N days"
                  : expiryFilter === "expiredOver"
                  ? "Expired over N days (90)"
                  : expiryFilter === "active"
                  ? "Expiring in N days"
                  : expiryFilter === "unavailable"
                  ? "N/A"
                  : "±N days from now"
              }
              value={withinDays}
              onChange={(e) => { setWithinDays(e.target.value); setPage(1); }}
              className="border rounded-lg px-2 py-1.5 text-sm w-32 focus:ring-2 focus:ring-blue-500 text-black disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </>
        }
        headerActions={
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search username or IP..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 text-black"
            />

            {/* ── Bulk Clear Sessions button ── */}
            {/* <Button
              size="sm"
              variant="destructive"
              className="gap-2"
              disabled={isBulkClearing}
              onClick={() => setShowBulkConfirm(true)}
            >
              {isBulkClearing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              {isBulkClearing ? "Clearing..." : "Clear Sessions"}
            </Button> */}

            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading..." : "Upload PPPoE Excel"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={uploadingChurn}
              onClick={() => churnFileInputRef.current?.click()}
            >
              {uploadingChurn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploadingChurn ? "Uploading..." : "Upload Churn Report"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={exporting}
              onClick={handleExport}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? "Exporting..." : "Export Excel"}
            </Button>
          </div>
        }
        pagination={{
          page,
          totalPages,
          onPageChange: (newPage: number) => setPage(newPage),
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
      />

      {/* ── Bulk Clear Confirmation Modal ─────────────────────────────────── */}
      <Dialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <DialogContent className="max-w-sm dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-destructive" />
              Confirm Bulk Session Clear
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-2 text-sm text-muted-foreground">
            <p>This will simultaneously:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-medium text-foreground">Clear expired IPv4 sessions</span>{" "}
                — disconnects expired, non-free customers
              </li>
              <li>
                <span className="font-medium text-foreground">Clear active IPv6 sessions</span>{" "}
                — forces re-dial so customers obtain IPv4 addresses
              </li>
            </ul>
            <p className="pt-1 text-xs">This action cannot be undone. Proceed?</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowBulkConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkClear}>
              Yes, Clear Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Clear Result Modal ───────────────────────────────────────── */}
      <Dialog open={isBulkClearModalOpen} onOpenChange={setIsBulkClearModalOpen}>
        <DialogContent className="max-w-lg dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Bulk Clear Results
            </DialogTitle>
          </DialogHeader>

          {isBulkClearing ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground text-sm">
                Clearing IPv4 expired &amp; IPv6 active sessions…
              </p>
            </div>
          ) : bulkClearResult ? (
            <div className="grid grid-cols-2 gap-4 py-2">
              {/* <BulkResultPanel
                label="IPv4 Expired Sessions"
                result={bulkClearResult.ipv4Result}
                error={bulkClearResult.ipv4Error}
                color="border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20"
              /> */}
              <BulkResultPanel
                label="IPv6 → IPv4 Sessions"
                result={bulkClearResult.ipv6Result}
                error={bulkClearResult.ipv6Error}
                color="border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20"
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button onClick={() => setIsBulkClearModalOpen(false)} type="button">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Per-row Clear Result Modal ────────────────────────────────────── */}
      <Dialog open={isRowClearModalOpen} onOpenChange={setIsRowClearModalOpen}>
        <DialogContent className="max-w-md dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WifiOff className="h-5 w-5" />
              Clear PPPoE Session
            </DialogTitle>
          </DialogHeader>

          {clearingUsername ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground text-sm">
                Clearing session for{" "}
                <span className="font-mono font-medium text-foreground">
                  {clearingUsername}
                </span>
                …
              </p>
            </div>
          ) : rowClearError ? (
            <div className="py-4 text-red-500 text-sm font-medium">{rowClearError}</div>
          ) : rowClearResult ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">{rowClearResult.message}</p>

              {/* Summary card */}
              <div className="flex gap-3">
                <div className="flex-1 rounded-xl border p-4 bg-muted/40">
                  <p className="text-xs text-muted-foreground">PPPoE Username</p>
                  <p className="font-mono text-sm font-medium break-all">
                    {rowClearResult.pppoeusername}
                  </p>
                </div>
                <div className="rounded-xl border p-4 bg-muted/40 text-center min-w-[90px]">
                  <p className="text-xs text-muted-foreground">Cleared</p>
                  <p className="text-3xl font-bold">{rowClearResult.totalCleared}</p>
                </div>
              </div>

              {/* Per-switch breakdown */}
              {(rowClearResult.details as SwitchDetail[])?.length > 0 && (
                <div className="space-y-2">
                  {(rowClearResult.details as SwitchDetail[]).map((sw, i) => (
                    <div key={i} className="rounded-lg border p-3 text-xs space-y-1">
                      <div className="flex justify-between font-medium">
                        <span>{sw.switch}</span>
                        <span>{sw.sessionsCleared.length} cleared</span>
                      </div>
                      {sw.sessionsFound.length > 0 && (
                        <p className="text-muted-foreground">
                          Found: {sw.sessionsFound.join(", ")}
                        </p>
                      )}
                      {sw.errors.length > 0 && (
                        <p className="text-red-500">
                          Errors: {sw.errors.map((e) => e.error).join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button onClick={() => setIsRowClearModalOpen(false)} type="button">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Upload Result Modal ───────────────────────────────────────────── */}
      <Dialog open={isUploadModalOpen} onOpenChange={setIsUploadModalOpen}>
        <DialogContent className="max-w-md dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Result
            </DialogTitle>
          </DialogHeader>
          {uploading ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground text-sm">Processing Excel file...</p>
            </div>
          ) : uploadError ? (
            <div className="text-red-500 py-4 text-sm font-medium">{uploadError}</div>
          ) : uploadResult ? (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Excel Unique Users", value: uploadResult.excelRows },
                  { label: "DB Records Missing Data", value: uploadResult.dbRecordsMissingData },
                  { label: "Matched in Excel", value: uploadResult.matched },
                  { label: "Updated", value: uploadResult.updated },
                  { label: "Not in Excel", value: uploadResult.notInExcel },
                  { label: "Already filled (skipped)", value: uploadResult.skipped },
                  { label: "Duplicate ID (skipped)", value: uploadResult.duplicateSkipped ?? 0 },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 rounded-xl bg-muted/50 border border-border">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setIsUploadModalOpen(false)} type="button">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Churn Report Upload Modal ─────────────────────────────────────── */}
      <Dialog open={isChurnModalOpen} onOpenChange={setIsChurnModalOpen}>
        <DialogContent className="max-w-md dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Churn Report Upload Result
            </DialogTitle>
          </DialogHeader>
          {uploadingChurn ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground text-sm">Processing churn report...</p>
            </div>
          ) : churnUploadError ? (
            <div className="text-red-500 py-4 text-sm font-medium">{churnUploadError}</div>
          ) : churnUploadResult ? (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Rows Parsed", value: churnUploadResult.stats?.parsed },
                  { label: "Upserted to Info", value: churnUploadResult.stats?.upserted },
                  { label: "Expired", value: churnUploadResult.stats?.expired },
                  { label: "Not in Network", value: churnUploadResult.stats?.skippedNoCustomer },
                  { label: "Not in Churn Report", value: churnUploadResult.stats?.notInInfo },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 rounded-xl bg-muted/50 border border-border">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold text-foreground">{value ?? "—"}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setIsChurnModalOpen(false)} type="button">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FTTHCustomer;