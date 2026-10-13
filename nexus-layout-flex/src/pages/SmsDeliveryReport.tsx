import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useParams, useNavigate } from "react-router-dom";
import { PRODUCTION_URL } from "@/utils/Api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Clock, Search } from "lucide-react";

type ReportEntry = {
  customerId: string | null;
  customerName: string | null;
  customerType: string | null;
  phoneNumber: string;
};

type FullDeliveryReport = {
  total: number;
  received: ReportEntry[];
  notReceived: ReportEntry[];
  pending: ReportEntry[];
};

const EntryList = ({ entries }: { entries: ReportEntry[] }) => {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground italic text-center py-6">None</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Customer ID</th>
            <th className="text-left px-4 py-2 font-medium">Customer Name</th>
            <th className="text-left px-4 py-2 font-medium">Phone Number</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry, idx) => (
            <tr key={`${entry.phoneNumber}-${idx}`}>
              <td className="px-4 py-2 whitespace-nowrap">{entry.customerId || "-"}</td>
              <td className="px-4 py-2 whitespace-nowrap">{entry.customerName || "-"}</td>
              <td className="px-4 py-2 whitespace-nowrap">{entry.phoneNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SmsDeliveryReport = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FullDeliveryReport | null>(null);
  const [search, setSearch] = useState("");

  const matchesSearch = (entry: ReportEntry, query: string) => {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    return (
      (entry.customerName || "").toLowerCase().includes(q) ||
      (entry.customerId || "").toLowerCase().includes(q)
    );
  };

  const filtered = useMemo(() => {
    if (!report) return null;
    return {
      received: report.received.filter((e) => matchesSearch(e, search)),
      notReceived: report.notReceived.filter((e) => matchesSearch(e, search)),
      pending: report.pending.filter((e) => matchesSearch(e, search)),
    };
  }, [report, search]);

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem("userToken");
        const res = await axios.get(
          `${PRODUCTION_URL}/sms/campaigns/${campaignId}/delivery-report/full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setReport(res.data);
      } catch (err: any) {
        setError(err?.response?.data?.error || "Failed to fetch delivery report.");
      } finally {
        setLoading(false);
      }
    };
    if (campaignId) fetchReport();
  }, [campaignId]);

  return (
    <div className="p-6 mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SMS Delivery Report</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Per-recipient delivery status, resolved in the background against Beem's delivery-report API.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Loading report...</p>
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : report && filtered ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">Total Recipients</p>
              <p className="text-2xl font-bold">{report.total}</p>
            </div>
            <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4">
              <p className="text-xs text-muted-foreground">Received</p>
              <p className="text-2xl font-bold text-green-600">{report.received.length}</p>
            </div>
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-xs text-muted-foreground">Not Received</p>
              <p className="text-2xl font-bold text-red-600">{report.notReceived.length}</p>
            </div>
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer name or ID..."
              className="pl-8"
            />
          </div>

          {filtered.pending.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-500/20">
                <Clock className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-medium">
                  {filtered.pending.length} number(s) could not be checked (DLR lookup still pending or unresolved)
                  {search && ` — filtered from ${report.pending.length}`}
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <EntryList entries={filtered.pending} />
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <p className="text-sm font-medium">
                  Received ({filtered.received.length}{search ? ` of ${report.received.length}` : ""})
                </p>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <EntryList entries={filtered.received} />
              </div>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
                <XCircle className="h-4 w-4 text-red-600" />
                <p className="text-sm font-medium">
                  Not Received ({filtered.notReceived.length}{search ? ` of ${report.notReceived.length}` : ""})
                </p>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <EntryList entries={filtered.notReceived} />
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default SmsDeliveryReport;
