import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  Send,
  Mail,
  Plus,
  X,
  History,
  RefreshCw,
} from "lucide-react";
import ModeSelector from "@/components/sms-v2/ModeSelector";
import SwitchFilterPanel from "@/components/sms-v2/SwitchFilterPanel";
import ServiceTypeFilterPanel from "@/components/sms-v2/ServiceTypeFilterPanel";
import DowntimeFilterPanel, { DowntimeRange } from "@/components/sms-v2/DowntimeFilterPanel";
import { NON_FTTH_TYPES, SWITCH_SERVICE_TYPES, ALL_SERVICE_TYPES, ServiceType, SmsMode } from "@/components/sms-v2/types";
import EmailRecipientTable from "@/components/email-v2/RecipientTable";

type Recipient = {
  key: string;
  customerType: ServiceType;
  customerName: string | null;
  cid: string | null;
  interface: string | null;
  switchName: string | null;
  nbr: string | null;
  emailAddress: string | null;
  hasEmail: boolean;
  lastDownAt?: string;
};

type PreviewResponse = {
  mode: SmsMode;
  recipients: Recipient[];
  total: number;
  withEmail: number;
  withoutEmail: number;
  meta: Record<string, any>;
};

type Campaign = {
  id: string;
  customerType: string;
  subject: string;
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

const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const MAX_EMAIL_CHARS = 6000;

const EmailBroadcastV2 = () => {
  const [tab, setTab] = useState<"compose" | "history">("compose");

  const [mode, setMode] = useState<SmsMode>("bySwitch");
  const [switchNames, setSwitchNames] = useState<string[]>([]);
  const [switchServiceTypes, setSwitchServiceTypes] = useState<ServiceType[]>(SWITCH_SERVICE_TYPES);
  const [switchHighProfileOnly, setSwitchHighProfileOnly] = useState(false);
  const [serviceType, setServiceType] = useState<ServiceType>("FTTH");
  const [downtimeRange, setDowntimeRange] = useState<DowntimeRange>(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return { startDate: toLocalInputValue(start), endDate: toLocalInputValue(end) };
  });
  const [downtimeServiceTypes, setDowntimeServiceTypes] = useState<ServiceType[]>(ALL_SERVICE_TYPES);
  const [downtimeSwitchNames, setDowntimeSwitchNames] = useState<string[]>([]);

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [extraEmails, setExtraEmails] = useState<string[]>([]);
  const [extraInput, setExtraInput] = useState("");
  const [extraInputError, setExtraInputError] = useState("");

  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsPage, setCampaignsPage] = useState(1);
  const [campaignsTotalPages, setCampaignsTotalPages] = useState(1);

  const charsLeft = MAX_EMAIL_CHARS - message.length;
  const selectedRecipients = useMemo(() => recipients.filter((r) => selectedKeys.has(r.key)), [recipients, selectedKeys]);
  const totalRecipients = selectedRecipients.length + extraEmails.length;

  useEffect(() => {
    setRecipients([]);
    setSelectedKeys(new Set());
    setPreviewError(null);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    const fetchPreview = async (params: Record<string, string>) => {
      setLoadingPreview(true);
      setPreviewError(null);
      try {
        const res = await axios.get<PreviewResponse>(`${PRODUCTION_URL}/email/v2/preview`, {
          params: { mode, ...params },
          withCredentials: true,
        });
        if (cancelled) return;
        setRecipients(res.data.recipients || []);
        setSelectedKeys(new Set());
      } catch (err: any) {
        if (cancelled) return;
        setRecipients([]);
        setPreviewError(err?.response?.data?.error || "Failed to load recipients.");
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    };

    const handle = setTimeout(() => {
      if (mode === "bySwitch") {
        if (!switchNames.length) return;
        fetchPreview({
          switchName: switchNames.join(","),
          serviceTypes: switchServiceTypes.join(","),
          ...(switchHighProfileOnly ? { highProfileOnly: "1" } : {}),
        });
      } else if (mode === "byServiceType") {
        fetchPreview({ serviceType });
      } else if (mode === "byDowntime") {
        if (!downtimeRange.startDate || !downtimeRange.endDate) return;
        fetchPreview({
          startDate: downtimeRange.startDate,
          endDate: downtimeRange.endDate,
          serviceTypes: downtimeServiceTypes.join(","),
          ...(downtimeSwitchNames.length ? { switchName: downtimeSwitchNames.join(",") } : {}),
        });
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [mode, switchNames, switchServiceTypes, switchHighProfileOnly, serviceType, downtimeRange, downtimeServiceTypes, downtimeSwitchNames]);

  const fetchCampaigns = async (page = 1) => {
    setCampaignsLoading(true);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/email/campaigns?page=${page}&pageSize=10`, {
        withCredentials: true,
      });
      setCampaigns(res.data.campaigns || []);
      setCampaignsTotalPages(res.data.totalPages || 1);
      setCampaignsPage(page);
    } finally {
      setCampaignsLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "history") fetchCampaigns(1);
  }, [tab]);

  const handleAddExtra = () => {
    const email = extraInput.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setExtraInputError("Invalid email format.");
      return;
    }
    if (extraEmails.includes(email)) {
      setExtraInputError("Email already added.");
      return;
    }
    setExtraEmails((prev) => [...prev, email]);
    setExtraInput("");
    setExtraInputError("");
  };

  const handleRemoveExtra = (email: string) => {
    setExtraEmails((prev) => prev.filter((n) => n !== email));
  };

  const campaignLabel = useMemo(() => {
    if (mode === "bySwitch") return `switch:${switchNames.join("+")}`;
    if (mode === "byServiceType") return `service:${serviceType}`;
    return `downtime:${downtimeRange.startDate}..${downtimeRange.endDate}`;
  }, [mode, switchNames, serviceType, downtimeRange]);

  const confirmDescription = useMemo(() => {
    if (mode === "bySwitch") {
      const switchList = switchNames.map((s) => `"${s}"`).join(", ");
      return `${selectedRecipients.length} customer${selectedRecipients.length !== 1 ? "s" : ""} on switch${
        switchNames.length !== 1 ? "es" : ""
      } ${switchList}`;
    }
    if (mode === "byServiceType") {
      return `${selectedRecipients.length} ${serviceType} customer${selectedRecipients.length !== 1 ? "s" : ""}`;
    }
    return `${selectedRecipients.length} customer${selectedRecipients.length !== 1 ? "s" : ""} down in selected period (plus currently down from extended downtime logic)`;
  }, [mode, selectedRecipients.length, switchNames, serviceType]);

  const handleSend = async () => {
    setConfirmOpen(false);
    setSending(true);
    setResult(null);
    setSendError(null);
    try {
      const res = await axios.post(
        `${PRODUCTION_URL}/email/send`,
        {
          sendMode: "specific",
          customerType: campaignLabel,
          subject: subject.trim(),
          message: message.trim(),
          extraEmails,
          specificRecipients: selectedRecipients
            .filter((r) => r.emailAddress)
            .map((r) => ({
              customerId: r.cid,
              customerName: r.customerName,
              customerType: r.customerType,
              emailAddress: r.emailAddress,
            })),
        },
        { withCredentials: true }
      );
      setResult(res.data);
      setIsResultModalOpen(true);
    } catch (err: any) {
      setSendError(err?.response?.data?.error || "Failed to send email.");
      setIsResultModalOpen(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email Broadcast v2</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Target clients by switch, service type, or downtime window and send email updates in bulk.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["compose", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
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

      {tab === "compose" && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">How do you want to select recipients?</label>
            <ModeSelector value={mode} onChange={setMode} />
          </div>

          <div className="rounded-xl border border-border bg-background p-4">
            {mode === "bySwitch" && (
              <SwitchFilterPanel
                switchNames={switchNames}
                onSwitchNamesChange={setSwitchNames}
                serviceTypes={switchServiceTypes}
                onServiceTypesChange={setSwitchServiceTypes}
                highProfileOnly={switchHighProfileOnly}
                onHighProfileOnlyChange={setSwitchHighProfileOnly}
              />
            )}
            {mode === "byServiceType" && <ServiceTypeFilterPanel serviceType={serviceType} onChange={setServiceType} />}
            {mode === "byDowntime" && (
              <DowntimeFilterPanel
                range={downtimeRange}
                onRangeChange={setDowntimeRange}
                serviceTypes={downtimeServiceTypes}
                onServiceTypesChange={setDowntimeServiceTypes}
                switchNames={downtimeSwitchNames}
                onSwitchNamesChange={setDowntimeSwitchNames}
              />
            )}
          </div>

          {previewError && <p className="text-sm text-red-500">{previewError}</p>}

          <EmailRecipientTable
            recipients={recipients}
            loading={loadingPreview}
            selectedKeys={selectedKeys}
            onSelectedKeysChange={setSelectedKeys}
            showDownAt={mode === "byDowntime"}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium">Add Extra Emails</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. client@example.com"
                value={extraInput}
                onChange={(e) => {
                  setExtraInput(e.target.value);
                  setExtraInputError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAddExtra()}
                className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-background"
              />
              <Button size="sm" variant="outline" onClick={handleAddExtra} className="gap-1">
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
            {extraInputError && <p className="text-xs text-red-500">{extraInputError}</p>}
            {extraEmails.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {extraEmails.map((email) => (
                  <span key={email} className="flex items-center gap-1 bg-muted border border-border rounded-full px-3 py-1 text-xs font-medium">
                    <Mail className="h-3 w-3" />
                    {email}
                    <button onClick={() => handleRemoveExtra(email)} className="ml-1 hover:text-red-500 transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Subject</label>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Email subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Message</label>
            <textarea
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none min-h-[160px]"
              placeholder="Type your email message here..."
              maxLength={MAX_EMAIL_CHARS}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className={`text-xs text-right ${charsLeft < 200 ? "text-red-500" : "text-muted-foreground"}`}>
              {charsLeft} characters remaining
            </p>
          </div>

          <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-t border-border flex justify-end">
            <Button
              className="gap-2"
              disabled={!subject.trim() || !message.trim() || totalRecipients === 0 || sending || loadingPreview}
              onClick={() => setConfirmOpen(true)}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Sending..." : `Send to ${totalRecipients} recipient${totalRecipients !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Past email campaigns</p>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => fetchCampaigns(campaignsPage)}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
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
                      {new Date(c.createdAt).toLocaleString()} · {c.customerType}
                      {c.status && (
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${CAMPAIGN_STATUS_STYLES[c.status] || ""}`}>
                          {c.status}
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm font-medium truncate max-w-xs">{c.subject}</p>
                    <p className="text-xs text-muted-foreground">{c.totalSent} sent ({c.customerCount} customers{c.extraCount > 0 ? ` + ${c.extraCount} extra` : ""})</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {campaignsTotalPages > 1 && (
            <div className="flex justify-center gap-2 pt-2">
              <Button size="sm" variant="outline" disabled={campaignsPage <= 1} onClick={() => fetchCampaigns(campaignsPage - 1)}>Prev</Button>
              <span className="text-sm text-muted-foreground self-center">Page {campaignsPage} / {campaignsTotalPages}</span>
              <Button size="sm" variant="outline" disabled={campaignsPage >= campaignsTotalPages} onClick={() => fetchCampaigns(campaignsPage + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm dark:text-white">
          <DialogHeader><DialogTitle>Confirm Email Broadcast</DialogTitle></DialogHeader>
          <div className="py-2 space-y-2 text-sm">
            <p>
              You are about to send an email to <span className="font-bold">{totalRecipients}</span> recipient
              {totalRecipients !== 1 ? "s" : ""} — {confirmDescription}
              {extraEmails.length > 0 ? ` + ${extraEmails.length} manually added` : ""}.
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground italic">
              <p className="font-semibold not-italic text-foreground mb-1">{subject}</p>
              {message}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleSend}><Send className="h-4 w-4 mr-2" />Confirm & Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isResultModalOpen} onOpenChange={setIsResultModalOpen}>
        <DialogContent className="max-w-sm dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Email Broadcast Result</DialogTitle>
          </DialogHeader>
          {sendError ? (
            <div className="text-red-500 py-4 text-sm font-medium">{sendError}</div>
          ) : result ? (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Sent", value: result.sent },
                  { label: "Failed", value: result.failed },
                  { label: "Manual", value: result.extraCount ?? 0 },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 rounded-xl bg-muted/50 border border-border">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold text-foreground">{value ?? "-"}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{result.message}</p>
            </div>
          ) : null}
          <DialogFooter><Button onClick={() => setIsResultModalOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmailBroadcastV2;
