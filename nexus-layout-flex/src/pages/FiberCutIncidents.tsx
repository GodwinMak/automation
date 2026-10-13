import { useState, useEffect, useCallback, Fragment } from "react";
import axios from "axios";
import {
  Cable,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  MapPin,
  Globe,
  Download,
  Lock,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import { PRODUCTION_URL } from "@/utils/Api";

interface Incident {
  id: string;
  scope: "NBR" | "GLOBAL";
  nbr: string | null;
  status: "open" | "resolved" | "closed";
  startedAt: string;
  detectedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  closedByName: string | null;
  closeComment: string | null;
  customerCount: number;
  restoredCount: number;
  stillDownCount: number;
  durationSeconds: number;
  durationFormatted: string;
  serviceBreakdown?: {
    ftth: {
      customerCount: number;
      restoredCount: number;
      stillDownCount: number;
    };
    nonFtth: {
      customerCount: number;
      restoredCount: number;
      stillDownCount: number;
    };
  };
}

interface IncidentMember {
  id: string;
  customerType: string;
  interface: string;
  customerName: string | null;
  cid: string | null;
  nbr: string | null;
  switchName: string | null;
  status: "down" | "restored";
  downAt: string;
  restoredAt: string | null;
  downtimeSeconds: number;
  downtimeFormatted: string;
}

interface IncidentDetail extends Incident {
  groupedMembers?: {
    ftth: IncidentMember[];
    nonFtth: IncidentMember[];
  };
  members: IncidentMember[];
}

const TYPE_COLORS: Record<string, string> = {
  DIA: "#3b82f6",
  IPT: "#8b5cf6",
  SHARED: "#06b6d4",
  L3VPN: "#10b981",
  FTTH: "#14b8a6",
};

const OPEN_POLL_MS = 30000;

export default function FiberCutIncidents() {
  const [loading, setLoading] = useState(true);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, IncidentDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [config, setConfig] = useState<{ windowMinutes: number; thresholdCustomers: number } | null>(null);
  const [closeTarget, setCloseTarget] = useState<Incident | null>(null);
  const [closeComment, setCloseComment] = useState("");
  const [closing, setClosing] = useState(false);
  const [serviceView, setServiceView] = useState<"all" | "FTTH" | "NonFTTH">("all");

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/fiber-cut-incidents`, {
        params: { status: statusFilter, pageSize: 50 },
      });
      setIncidents(res.data.data || []);
      setConfig(res.data.config || null);
    } catch (error) {
      console.error("Error fetching fiber cut incidents:", error);
      toast.error("Failed to fetch fiber cut incidents");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(id);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/fiber-cut-incidents/${id}`);
      setDetail((prev) => ({ ...prev, [id]: res.data }));
    } catch (error) {
      console.error("Error fetching incident detail:", error);
      toast.error("Failed to fetch incident details");
    } finally {
      setDetailLoading(null);
    }
  }, []);

  // Live-refresh while incidents are open so restoration progress updates —
  // including the expanded per-customer table, which otherwise stays frozen
  // at whatever it looked like when first opened.
  useEffect(() => {
    if (statusFilter !== "open") return;
    const interval = setInterval(() => {
      fetchIncidents();
      if (expandedId) fetchDetail(expandedId);
    }, OPEN_POLL_MS);
    return () => clearInterval(interval);
  }, [statusFilter, fetchIncidents, fetchDetail, expandedId]);

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    // Always fetch fresh — a cached copy from an earlier expand can be stale
    // (e.g. a member has since come back up).
    fetchDetail(id);
  };

  const openCloseDialog = (incident: Incident) => {
    setCloseComment("");
    setCloseTarget(incident);
  };

  const handleConfirmClose = async () => {
    if (!closeTarget) return;
    setClosing(true);
    try {
      await axios.patch(`${PRODUCTION_URL}/fiber-cut-incidents/${closeTarget.id}/close`, {
        comment: closeComment,
      });
      toast.success("Incident closed");
      setCloseTarget(null);
      await fetchIncidents();
      await fetchDetail(closeTarget.id);
    } catch (error: any) {
      console.error("Error closing incident:", error);
      toast.error(error?.response?.data?.error || "Failed to close incident");
    } finally {
      setClosing(false);
    }
  };

  const handleExport = (incident: IncidentDetail) => {
    const headers = [
      "Customer Name",
      "Interface",
      "Type",
      "NBR",
      "Switch",
      "Status",
      "Down At",
      "Restored At",
      "Downtime",
    ];
    const escapeCsv = (value: any) => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
      return str;
    };
    const rows = incident.members.map((m) => [
      m.customerName || "",
      m.interface || "",
      m.customerType || "",
      m.nbr || "",
      m.switchName || "",
      m.status,
      new Date(m.downAt).toLocaleString(),
      m.restoredAt ? new Date(m.restoredAt).toLocaleString() : "",
      m.downtimeFormatted,
    ]);
    const csvContent = [headers.join(","), ...rows.map((row) => row.map(escapeCsv).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `fiber_cut_incident_${incident.nbr || incident.scope}_${incident.id.slice(0, 8)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const openCount = incidents.filter((i) => i.status === "open").length;
  const impactedCount = incidents.reduce((sum, i) => sum + i.customerCount, 0);
  const stillDownCount = incidents.reduce((sum, i) => sum + i.stillDownCount, 0);
  const ftthImpactedCount = incidents.reduce(
    (sum, i) => sum + (i.serviceBreakdown?.ftth.customerCount || 0),
    0
  );
  const ftthStillDownCount = incidents.reduce(
    (sum, i) => sum + (i.serviceBreakdown?.ftth.stillDownCount || 0),
    0
  );
  const nonFtthImpactedCount = incidents.reduce(
    (sum, i) => sum + (i.serviceBreakdown?.nonFtth.customerCount || 0),
    0
  );
  const nonFtthStillDownCount = incidents.reduce(
    (sum, i) => sum + (i.serviceBreakdown?.nonFtth.stillDownCount || 0),
    0
  );

  // Incidents are mixed-type (one fiber cut can hit both FTTH and non-FTTH
  // customers), so the toggle doesn't split incidents into separate lists —
  // it hides incidents with zero customers of the selected type, and swaps
  // the Impacted/Restored/Still Down columns (and the expanded detail) over
  // to that type's numbers instead of the combined total.
  const filteredIncidents = incidents.filter((incident) => {
    if (serviceView === "all") return true;
    const breakdown = incident.serviceBreakdown;
    if (!breakdown) return true;
    return serviceView === "FTTH"
      ? breakdown.ftth.customerCount > 0
      : breakdown.nonFtth.customerCount > 0;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cable className="h-6 w-6 text-red-400" />
            Fiber Cut Incidents
          </h1>
          <p className="text-muted-foreground mt-1">
            {config
              ? `Groups of ${config.thresholdCustomers}+ customers down within ${config.windowMinutes} minutes, monitored until fully restored`
              : "Mass outage detection and restoration monitoring"}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Ongoing</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              fetchIncidents();
              if (expandedId) fetchDetail(expandedId);
            }}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="border-border/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Ongoing Incidents</p>
              <p className="text-2xl font-bold mt-1">{openCount}</p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Customers Impacted ({statusFilter})</p>
              <p className="text-2xl font-bold mt-1">{impactedCount}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-500/10">
              <Users className="h-5 w-5 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Still Down</p>
              <p className="text-2xl font-bold mt-1">{stillDownCount}</p>
            </div>
            <div className="p-3 rounded-lg bg-orange-500/10">
              <Clock className="h-5 w-5 text-orange-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">FTTH Impact ({statusFilter})</p>
            <p className="text-2xl font-bold mt-1 text-cyan-400">{ftthImpactedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">Still down: {ftthStillDownCount}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Non-FTTH Impact ({statusFilter})</p>
            <p className="text-2xl font-bold mt-1 text-blue-400">{nonFtthImpactedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">Still down: {nonFtthStillDownCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={serviceView === "FTTH" ? "default" : "outline"}
          size="sm"
          onClick={() => setServiceView((prev) => (prev === "FTTH" ? "all" : "FTTH"))}
          className={serviceView === "FTTH" ? "bg-cyan-500 hover:bg-cyan-600 text-white" : ""}
        >
          FTTH
        </Button>
        <Button
          variant={serviceView === "NonFTTH" ? "default" : "outline"}
          size="sm"
          onClick={() => setServiceView((prev) => (prev === "NonFTTH" ? "all" : "NonFTTH"))}
          className={serviceView === "NonFTTH" ? "bg-blue-500 hover:bg-blue-600 text-white" : ""}
        >
          Non-FTTH
        </Button>
        {serviceView !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setServiceView("all")}>
            Clear filter
          </Button>
        )}
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Incidents</CardTitle>
          <CardDescription>Click an incident to see every impacted customer and their restoration time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>Location / Scope</TableHead>
                  <TableHead className="text-center">Impacted</TableHead>
                  <TableHead className="text-center">Restored</TableHead>
                  <TableHead className="text-center">Still Down</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredIncidents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      {loading
                        ? "Loading..."
                        : serviceView !== "all"
                        ? `No ${serviceView === "FTTH" ? "FTTH" : "Non-FTTH"} incidents found`
                        : "No fiber cut incidents found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredIncidents.map((incident) => {
                    const breakdown =
                      serviceView === "FTTH"
                        ? incident.serviceBreakdown?.ftth
                        : serviceView === "NonFTTH"
                        ? incident.serviceBreakdown?.nonFtth
                        : null;
                    const rowImpacted = breakdown ? breakdown.customerCount : incident.customerCount;
                    const rowRestored = breakdown ? breakdown.restoredCount : incident.restoredCount;
                    const rowStillDown = breakdown ? breakdown.stillDownCount : incident.stillDownCount;
                    return (
                    <Fragment key={incident.id}>
                      <TableRow
                        key={incident.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(incident.id)}
                      >
                        <TableCell>
                          {expandedId === incident.id ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {incident.scope === "NBR" ? (
                              <MapPin className="h-4 w-4 text-yellow-400" />
                            ) : (
                              <Globe className="h-4 w-4 text-purple-400" />
                            )}
                            <div>
                              <p className="font-medium">{incident.nbr || "Network-wide"}</p>
                              <p className="text-xs text-muted-foreground">{incident.scope}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-bold">{rowImpacted}</TableCell>
                        <TableCell className="text-center text-green-400">{rowRestored}</TableCell>
                        <TableCell className="text-center text-red-400">{rowStillDown}</TableCell>
                        <TableCell className="text-sm">{new Date(incident.startedAt).toLocaleString()}</TableCell>
                        <TableCell className="font-mono text-sm">{incident.durationFormatted}</TableCell>
                        <TableCell>
                          {incident.status === "open" && (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse">
                              ONGOING
                            </Badge>
                          )}
                          {incident.status === "resolved" && (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              RESOLVED
                            </Badge>
                          )}
                          {incident.status === "closed" && (
                            <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">
                              <Lock className="h-3 w-3 mr-1" />
                              CLOSED
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {incident.status === "open" && (
                            <Button variant="outline" size="sm" onClick={() => openCloseDialog(incident)}>
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Close
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expandedId === incident.id && (
                        <TableRow key={`${incident.id}-detail`}>
                          <TableCell colSpan={9} className="bg-muted/20 p-0">
                            <IncidentDetailPanel
                              incident={detail[incident.id]}
                              loading={detailLoading === incident.id}
                              onExport={handleExport}
                              serviceView={serviceView}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!closeTarget} onOpenChange={(open) => !open && setCloseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Incident</DialogTitle>
            <DialogDescription>
              {closeTarget?.stillDownCount
                ? `${closeTarget.stillDownCount} of ${closeTarget.customerCount} customers are still down on this incident. A comment is required explaining why you're closing it anyway.`
                : "All customers on this incident have been restored. A comment is optional."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="e.g. Remaining customers confirmed unrelated to the fiber cut — CPE issue being handled separately."
            value={closeComment}
            onChange={(e) => setCloseComment(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)} disabled={closing}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmClose}
              disabled={closing || (!!closeTarget?.stillDownCount && !closeComment.trim())}
            >
              {closing ? "Closing..." : "Close Incident"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IncidentDetailPanel({
  incident,
  loading,
  onExport,
  serviceView,
}: {
  incident: IncidentDetail | undefined;
  loading: boolean;
  onExport: (incident: IncidentDetail) => void;
  serviceView: "all" | "FTTH" | "NonFTTH";
}) {
  if (loading || !incident) {
    return <div className="p-4 text-sm text-muted-foreground">Loading customer breakdown...</div>;
  }

  const durationLabel =
    incident.status === "resolved"
      ? "full restoration"
      : incident.status === "closed"
      ? "manual close"
      : "now";

  const ftthMembers = incident.groupedMembers?.ftth || incident.members.filter((m) => m.customerType === "FTTH");
  const nonFtthMembers =
    incident.groupedMembers?.nonFtth || incident.members.filter((m) => m.customerType !== "FTTH");

  const ftthRestored = ftthMembers.filter((m) => m.status === "restored").length;
  const nonFtthRestored = nonFtthMembers.filter((m) => m.status === "restored").length;

  // When a service toggle is active, the customer table below only shows
  // that type's members, and the summary line/export switch to match.
  const displayMembers =
    serviceView === "FTTH" ? ftthMembers : serviceView === "NonFTTH" ? nonFtthMembers : incident.members;
  const summaryImpacted = displayMembers.length;
  const summaryRestored = displayMembers.filter((m) => m.status === "restored").length;
  const summaryStillDown = summaryImpacted - summaryRestored;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {summaryImpacted} customers impacted &middot; {summaryRestored} restored &middot;{" "}
          {summaryStillDown} still down &middot; total time from impact to {durationLabel}:{" "}
          <span className="font-mono font-semibold text-foreground">{incident.durationFormatted}</span>
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExport(serviceView === "all" ? incident : { ...incident, members: displayMembers })}
        >
          <Download className="h-3.5 w-3.5 mr-1" />
          Export CSV
        </Button>
      </div>
      {serviceView === "all" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm">
            <p className="font-semibold text-cyan-300">FTTH</p>
            <p className="text-muted-foreground mt-1">
              Impacted: {ftthMembers.length} &middot; Restored: {ftthRestored} &middot; Still down: {ftthMembers.length - ftthRestored}
            </p>
          </div>
          <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
            <p className="font-semibold text-blue-300">Non-FTTH</p>
            <p className="text-muted-foreground mt-1">
              Impacted: {nonFtthMembers.length} &middot; Restored: {nonFtthRestored} &middot; Still down: {nonFtthMembers.length - nonFtthRestored}
            </p>
          </div>
        </div>
      )}
      {incident.status === "closed" && (
        <div className="rounded-md border border-slate-500/30 bg-slate-500/10 p-3 text-sm">
          <p className="font-medium text-slate-300 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            Closed by {incident.closedByName || "unknown"}
            {incident.closedAt && ` on ${new Date(incident.closedAt).toLocaleString()}`}
          </p>
          {incident.closeComment && (
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{incident.closeComment}</p>
          )}
        </div>
      )}
      <div className="rounded-md border border-border/50 max-h-[400px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>NBR</TableHead>
              <TableHead>Switch</TableHead>
              <TableHead>Down At</TableHead>
              <TableHead>Restored At</TableHead>
              <TableHead>Downtime</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayMembers.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <p className="font-medium text-sm">{m.customerName || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">{m.interface}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" style={{ borderColor: TYPE_COLORS[m.customerType] }}>
                    {m.customerType}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{m.nbr || "-"}</TableCell>
                <TableCell className="text-sm">{m.switchName || "-"}</TableCell>
                <TableCell className="text-sm">{new Date(m.downAt).toLocaleString()}</TableCell>
                <TableCell className="text-sm">
                  {m.restoredAt ? new Date(m.restoredAt).toLocaleString() : "-"}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  <span className={m.status === "down" ? "text-red-400" : "text-green-400"}>
                    {m.downtimeFormatted}
                  </span>
                </TableCell>
                <TableCell>
                  {m.status === "down" ? (
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30">DOWN</Badge>
                  ) : (
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">RESTORED</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
