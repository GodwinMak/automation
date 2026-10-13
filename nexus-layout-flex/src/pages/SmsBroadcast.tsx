import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Send, Users, Phone, Plus, X, History, CheckCircle2, XCircle, RefreshCw, Upload, ListChecks } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Recipient = {
  customerID: string;
  customerName: string | null;
  homeNumber: string;
};

type Campaign = {
  id: string;
  customerType: string;
  message: string;
  status?: "queued" | "sending" | "completed" | "failed";
  errorMessage?: string | null;
  totalSent: number;
  customerCount: number;
  extraCount: number;
  createdAt: string;
};

const CAMPAIGN_STATUS_STYLES: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  sending: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  completed: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
};

type DlrSummary = {
  accepted: number;
  rejected: number;
  total: number;
};

type DlrReport = {
  summary: DlrSummary;
  requestIds: string[];
  hasStoredStats: boolean;
  note: string;
};

const CUSTOMER_TYPES = [
  { value: "ftth", label: "FTTH Customers", contactField: "Home Number" },
];

const SmsBroadcast = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"compose" | "history">("compose");

  // --- Compose tab state ---
  const [customerType, setCustomerType] = useState("ftth");
  const [message, setMessage] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [extraNumbers, setExtraNumbers] = useState<string[]>([]);
  const [extraInput, setExtraInput] = useState("");
  const [extraInputError, setExtraInputError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadingList, setUploadingList] = useState(false);
  const [uploadListInfo, setUploadListInfo] = useState<string | null>(null);
  const [uploadListError, setUploadListError] = useState<string | null>(null);
  const uploadListInputRef = useRef<HTMLInputElement>(null);

  // --- History tab state ---
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsPage, setCampaignsPage] = useState(1);
  const [campaignsTotalPages, setCampaignsTotalPages] = useState(1);
  const [dlrCampaignId, setDlrCampaignId] = useState<string | null>(null);
  const [dlrLoading, setDlrLoading] = useState(false);
  const [dlrResult, setDlrResult] = useState<DlrReport | null>(null);
  const [dlrError, setDlrError] = useState<string | null>(null);
  const [dlrModalOpen, setDlrModalOpen] = useState(false);

  const MAX_SMS_CHARS = 480;
  const charsLeft = MAX_SMS_CHARS - message.length;
  const filteredRecipients = recipients.filter(
    (r) =>
      !searchQuery ||
      (r.customerName?.toLowerCase() ?? "").includes(searchQuery.toLowerCase()) ||
      r.customerID.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.homeNumber.includes(searchQuery)
  );
  const selectedRecipients = recipients.filter((r) => selectedIds.has(r.customerID));
  const totalRecipients = selectedRecipients.length + extraNumbers.length;

  // Fetch recipients preview
  const fetchPreview = async (type: string) => {
    setLoadingPreview(true);
    setRecipients([]);
    setError(null);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/sms/preview?customerType=${type}`, {
        withCredentials: true,
      });
      setRecipients(res.data.recipients || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load recipients.");
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    fetchPreview(customerType);
  }, [customerType]);

  // Auto-select all recipients whenever the list refreshes
  useEffect(() => {
    setSelectedIds(new Set(recipients.map((r) => r.customerID)));
    setSearchQuery("");
  }, [recipients]);

  // Fetch campaigns when History tab is opened
  const fetchCampaigns = async (page = 1) => {
    setCampaignsLoading(true);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/sms/campaigns?page=${page}&pageSize=10`, {
        withCredentials: true,
      });
      setCampaigns(res.data.campaigns || []);
      setCampaignsTotalPages(res.data.totalPages || 1);
      setCampaignsPage(page);
    } catch {
      // silent
    } finally {
      setCampaignsLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "history") fetchCampaigns(1);
  }, [tab]);

  const handleAddExtra = () => {
    const num = extraInput.trim();
    if (!num) return;
    if (!/^[\d\s\+\-]{6,20}$/.test(num)) {
      setExtraInputError("Invalid phone number format.");
      return;
    }
    if (extraNumbers.includes(num)) {
      setExtraInputError("Number already added.");
      return;
    }
    setExtraNumbers((prev) => [...prev, num]);
    setExtraInput("");
    setExtraInputError("");
  };

  const handleRemoveExtra = (num: string) => {
    setExtraNumbers((prev) => prev.filter((n) => n !== num));
  };

  // Upload an Excel file with a "Customer ID" column and select only those
  // recipients (from the currently loaded list) that appear in the file.
  const handleUploadList = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadingList(true);
    setUploadListInfo(null);
    setUploadListError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await axios.post(`${PRODUCTION_URL}/sms/select-from-file`, formData, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });
      const fileIds: string[] = res.data.customerIDs || [];
      const fileIdSet = new Set(fileIds);
      const matched = recipients.filter((r) => fileIdSet.has(r.customerID));
      setSelectedIds(new Set(matched.map((r) => r.customerID)));
      const notFound = fileIds.length - matched.length;
      setUploadListInfo(
        `Selected ${matched.length} of ${fileIds.length} customer ID${fileIds.length !== 1 ? "s" : ""} from file` +
          (notFound > 0 ? ` (${notFound} not found in the current list).` : ".")
      );
    } catch (err: any) {
      setUploadListError(err?.response?.data?.error || "Failed to process file.");
    } finally {
      setUploadingList(false);
    }
  };

  const handleSend = async () => {
    setConfirmOpen(false);
    setSending(true);
    setResult(null);
    setError(null);
    try {
      const res = await axios.post(
        `${PRODUCTION_URL}/sms/send`,
        {
          sendMode: "specific",
          customerType,
          message: message.trim(),
          extraNumbers,
          specificRecipients: selectedRecipients.map((r) => ({
            customerId: r.customerID,
            customerName: r.customerName,
            customerType: "FTTH",
            phoneNumber: r.homeNumber,
          })),
        },
        { withCredentials: true }
      );
      setResult(res.data);
      setIsResultModalOpen(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to send SMS.");
      setIsResultModalOpen(true);
    } finally {
      setSending(false);
    }
  };

  const handleCheckDelivery = async (campaignId: string) => {
    setDlrCampaignId(campaignId);
    setDlrLoading(true);
    setDlrResult(null);
    setDlrError(null);
    setDlrModalOpen(true);
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/sms/campaigns/${campaignId}/delivery-report`,
        { withCredentials: true }
      );
      setDlrResult(res.data);
    } catch (err: any) {
      setDlrError(err?.response?.data?.error || "Failed to fetch delivery report.");
    } finally {
      setDlrLoading(false);
    }
  };

  return (
    <div className="p-6 mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SMS Broadcast</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Send a bulk SMS to customers using their registered contact number.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(["compose", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "history" ? (
              <span className="flex items-center gap-1.5"><History className="h-4 w-4" />History</span>
            ) : (
              <span className="flex items-center gap-1.5"><Send className="h-4 w-4" />Compose</span>
            )}
          </button>
        ))}
      </div>

      {/* ── COMPOSE TAB ── */}
      {tab === "compose" && (
        <>
          {/* Customer Type */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Customer Type</label>
            <Select
              value={customerType}
              onValueChange={(v) => { setCustomerType(v); setMessage(""); }}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Recipient Selection */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                Recipients
              </div>
              {loadingPreview ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {selectedIds.size} / {recipients.length} selected
                </span>
              )}
            </div>

            {!loadingPreview && recipients.length > 0 && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Search by name or number…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      filteredRecipients.forEach((r) => next.add(r.customerID));
                      return next;
                    })
                  }
                >
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      filteredRecipients.forEach((r) => next.delete(r.customerID));
                      return next;
                    })
                  }
                >
                  Deselect all
                </Button>
                <input
                  ref={uploadListInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleUploadList}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 shrink-0"
                  disabled={uploadingList}
                  onClick={() => uploadListInputRef.current?.click()}
                >
                  {uploadingList ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Upload list
                </Button>
              </div>
            )}

            {(uploadListInfo || uploadListError) && (
              <p className={`text-xs ${uploadListError ? "text-red-500" : "text-muted-foreground"}`}>
                {uploadListError || uploadListInfo}
              </p>
            )}

            {!loadingPreview && recipients.length > 0 && (
              <div className="max-h-60 overflow-y-auto divide-y divide-border rounded-lg border border-border bg-background">
                {filteredRecipients.map((r) => (
                  <div
                    key={r.customerID}
                    className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        next.has(r.customerID) ? next.delete(r.customerID) : next.add(r.customerID);
                        return next;
                      })
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.customerID)}
                      onChange={() => {}}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-medium truncate">{r.customerName || "—"}</span>
                      <span className="text-xs text-muted-foreground">{r.customerID}</span>
                    </div>
                    <span className="flex items-center gap-1 text-muted-foreground text-xs shrink-0">
                      <Phone className="h-3 w-3" />{r.homeNumber}
                    </span>
                  </div>
                ))}
                {filteredRecipients.length === 0 && (
                  <p className="text-sm text-muted-foreground italic text-center py-4">No matches found.</p>
                )}
              </div>
            )}

            {!loadingPreview && recipients.length === 0 && !error && (
              <p className="text-sm text-muted-foreground italic">No customers with a home number found.</p>
            )}
            {error && !isResultModalOpen && <p className="text-sm text-red-500">{error}</p>}
          </div>

          {/* Extra Numbers */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Add Extra Numbers</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. +255712345678"
                value={extraInput}
                onChange={(e) => { setExtraInput(e.target.value); setExtraInputError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleAddExtra()}
                className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-background"
              />
              <Button size="sm" variant="outline" onClick={handleAddExtra} className="gap-1">
                <Plus className="h-4 w-4" />Add
              </Button>
            </div>
            {extraInputError && <p className="text-xs text-red-500">{extraInputError}</p>}
            {extraNumbers.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {extraNumbers.map((num) => (
                  <span key={num} className="flex items-center gap-1 bg-muted border border-border rounded-full px-3 py-1 text-xs font-medium">
                    <Phone className="h-3 w-3" />{num}
                    <button onClick={() => handleRemoveExtra(num)} className="ml-1 hover:text-red-500 transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Message */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Message</label>
            <textarea
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none min-h-[120px]"
              placeholder="Type your SMS message here..."
              maxLength={MAX_SMS_CHARS}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className={`text-xs text-right ${charsLeft < 50 ? "text-red-500" : "text-muted-foreground"}`}>
              {charsLeft} characters remaining
            </p>
          </div>

          {/* Send */}
          <div className="flex justify-end">
            <Button
              className="gap-2"
              disabled={!message.trim() || totalRecipients === 0 || sending || loadingPreview}
              onClick={() => setConfirmOpen(true)}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Sending..." : `Send to ${totalRecipients} recipient${totalRecipients !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === "history" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Past broadcast campaigns</p>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => fetchCampaigns(campaignsPage)}>
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </Button>
          </div>

          {campaignsLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-10">No campaigns yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              {campaigns.map((c) => (
                <div key={c.id} className="flex items-start justify-between px-4 py-3 gap-4 bg-background hover:bg-muted/30 transition-colors">
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      {new Date(c.createdAt).toLocaleString()} · {c.customerType.toUpperCase()}
                      {c.status && (
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${CAMPAIGN_STATUS_STYLES[c.status] || ""}`}>
                          {c.status}
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm font-medium truncate max-w-xs">{c.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.totalSent} sent ({c.customerCount} customers
                      {c.extraCount > 0 ? ` + ${c.extraCount} extra` : ""})
                    </p>
                    {c.status === "failed" && c.errorMessage && (
                      <p className="text-xs text-red-500">{c.errorMessage}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      onClick={() => handleCheckDelivery(c.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />Delivery Report
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      onClick={() => navigate(`/sms-broadcast/delivery-report/${c.id}`)}
                    >
                      <ListChecks className="h-3.5 w-3.5" />Full Report
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Campaigns pagination */}
          {campaignsTotalPages > 1 && (
            <div className="flex justify-center gap-2 pt-2">
              <Button size="sm" variant="outline" disabled={campaignsPage <= 1} onClick={() => fetchCampaigns(campaignsPage - 1)}>Prev</Button>
              <span className="text-sm text-muted-foreground self-center">Page {campaignsPage} / {campaignsTotalPages}</span>
              <Button size="sm" variant="outline" disabled={campaignsPage >= campaignsTotalPages} onClick={() => fetchCampaigns(campaignsPage + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      {/* ── Confirm Send Dialog ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm dark:text-white">
          <DialogHeader><DialogTitle>Confirm SMS Broadcast</DialogTitle></DialogHeader>
          <div className="py-2 space-y-2 text-sm">
            <p>
              You are about to send an SMS to <span className="font-bold">{totalRecipients}</span> recipient{totalRecipients !== 1 ? "s" : ""}
              {" "}({selectedRecipients.length} selected customers{extraNumbers.length > 0 ? ` + ${extraNumbers.length} manually added` : ""}).
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground italic">{message}</div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleSend}><Send className="h-4 w-4 mr-2" />Confirm &amp; Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Send Result Modal ── */}
      <Dialog open={isResultModalOpen} onOpenChange={setIsResultModalOpen}>
        <DialogContent className="max-w-sm dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" />SMS Broadcast Result</DialogTitle>
          </DialogHeader>
          {error ? (
            <div className="text-red-500 py-4 text-sm font-medium">{error}</div>
          ) : result ? (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Recipients Queued", value: result.queued ?? result.sent },
                  { label: "Customers Found", value: result.customerCount },
                  { label: "Manually Added", value: result.extraCount ?? 0 },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 rounded-xl bg-muted/50 border border-border">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold text-foreground">{value ?? "—"}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{result.message}</p>
              <p className="text-xs text-muted-foreground">Sending happens in the background. Check the <strong>History</strong> tab shortly to see it appear, then again in ~5 minutes for delivery status.</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setIsResultModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delivery Report Modal ── */}
      <Dialog open={dlrModalOpen} onOpenChange={setDlrModalOpen}>
        <DialogContent className="max-w-md dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />Delivery Report</DialogTitle>
          </DialogHeader>

          {dlrLoading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading campaign stats...</p>
            </div>
          ) : dlrError ? (
            <div className="text-red-500 py-4 text-sm font-medium">{dlrError}</div>
          ) : dlrResult ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center p-3 rounded-xl bg-green-500/10 border border-green-500/30">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <p className="text-2xl font-bold mt-1">{dlrResult.summary.accepted}</p>
                  <p className="text-[10px] text-muted-foreground text-center mt-0.5">ACCEPTED</p>
                </div>
                <div className="flex flex-col items-center p-3 rounded-xl bg-red-500/10 border border-red-500/30">
                  <XCircle className="h-5 w-5 text-red-500" />
                  <p className="text-2xl font-bold mt-1">{dlrResult.summary.rejected}</p>
                  <p className="text-[10px] text-muted-foreground text-center mt-0.5">REJECTED</p>
                </div>
                <div className="flex flex-col items-center p-3 rounded-xl bg-muted/50 border border-border">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <p className="text-2xl font-bold mt-1">{dlrResult.summary.total}</p>
                  <p className="text-[10px] text-muted-foreground text-center mt-0.5">TOTAL</p>
                </div>
              </div>

              {dlrResult.summary.rejected === 0 ? (
                <p className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />All numbers were accepted by the network.
                </p>
              ) : (
                <p className="text-sm text-red-500 font-medium flex items-center gap-1.5">
                  <XCircle className="h-4 w-4" />{dlrResult.summary.rejected} number{dlrResult.summary.rejected !== 1 ? "s" : ""} were invalid and rejected at submission.
                </p>
              )}

              <p className="text-xs text-muted-foreground italic border-t border-border pt-3">{dlrResult.note}</p>
            </div>
          ) : null}

          <DialogFooter>
            <Button onClick={() => setDlrModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SmsBroadcast;
