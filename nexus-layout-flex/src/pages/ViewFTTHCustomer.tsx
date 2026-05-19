import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Wifi, Stethoscope, Loader2, CheckCircle2, XCircle, AlertCircle, Pencil } from "lucide-react";
import { PRODUCTION_URL } from "@/utils/Api";

const ViewFTTHCustomer = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = location;
  const customer = state?.customer;

  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResult, setDiagResult] = useState<any>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Edit modal state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editData, setEditData] = useState({
    customerID: customer.customerID || "",
    customerName: customer.customerName || "",
    homeNumber: customer.homeNumber || "",
    topUpExpiry: customer.topUpExpiry
      ? new Date(customer.topUpExpiry).toISOString().split("T")[0]
      : "",
    isFreeCustomer: customer.isFreeCustomer ?? false,
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);
  const [liveCustomer, setLiveCustomer] = useState(customer);

  const handleEditSave = async () => {
    setEditSaving(true);
    setEditError(null);
    setEditSuccess(false);
    try {
      const res = await axios.patch(
        `${PRODUCTION_URL}/ftthcustomers/${liveCustomer.id}`,
        editData,
        { withCredentials: true }
      );
      setLiveCustomer({ ...liveCustomer, ...res.data.customer });
      setEditSuccess(true);
    } catch (err: any) {
      setEditError(err?.response?.data?.message || "Update failed");
    } finally {
      setEditSaving(false);
    }
  };

  if (!customer) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">No customer data provided.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  const isUp = liveCustomer.status === "up";
  const ip = liveCustomer.ip;

  const handleDiagnose = async () => {
    setDiagnosing(true);
    setDiagResult(null);
    setDiagError(null);
    setIsModalOpen(true);
    try {
      const res = await axios.post(
        `${PRODUCTION_URL}/diagnosis/ftth`,
        { ip },
        { withCredentials: true }
      );
      setDiagResult(res.data);
    } catch (err: any) {
      setDiagError(err?.response?.data?.message || "Diagnosis failed");
    } finally {
      setDiagnosing(false);
    }
  };

  const infoRows = [
    { label: "Customer ID", value: liveCustomer.customerID || "-" },
    { label: "Customer Name", value: liveCustomer.customerName || "-" },
    { label: "PPPoE Username", value: liveCustomer.pppoeusername || "-" },
    { label: "IP Address", value: ip || "-" },
    { label: "IP Version", value: liveCustomer.ip_version || "-" },
    { label: "Status", value: liveCustomer.status?.toUpperCase() || "-" },
    { label: "Home Number", value: liveCustomer.homeNumber || "-" },
    { label: "Top-Up Expiry", value: liveCustomer.topUpExpiry ? new Date(liveCustomer.topUpExpiry).toLocaleDateString() : "-" },
    { label: "Free Customer", value: liveCustomer.isFreeCustomer ? "Yes" : "No" },
    { label: "Not in Churn Report", value: liveCustomer.notInInfo ? "Yes" : "No" },
  ];

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-teal-500/10">
                <Wifi className="h-5 w-5 text-teal-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {liveCustomer.customerName || liveCustomer.pppoeusername || "FTTH Customer"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {liveCustomer.customerID ? `${liveCustomer.customerID} · ` : ""}{ip}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              variant={isUp ? "default" : "destructive"}
              className={`text-sm px-3 py-1 ${isUp ? "bg-green-600 text-white" : ""}`}
            >
              {(liveCustomer.status || "UNKNOWN").toUpperCase()}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditData({
                  customerID: liveCustomer.customerID || "",
                  customerName: liveCustomer.customerName || "",
                  homeNumber: liveCustomer.homeNumber || "",
                  topUpExpiry: liveCustomer.topUpExpiry
                    ? new Date(liveCustomer.topUpExpiry).toISOString().split("T")[0]
                    : "",
                  isFreeCustomer: liveCustomer.isFreeCustomer ?? false,
                });
                setEditError(null);
                setEditSuccess(false);
                setIsEditOpen(true);
              }}
              className="gap-2"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button
              onClick={handleDiagnose}
              disabled={diagnosing || !ip}
              className="gap-2 bg-orange-500 hover:bg-orange-600 text-white"
              size="sm"
            >
              {diagnosing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Stethoscope className="h-4 w-4" />
              )}
              {diagnosing ? "Diagnosing..." : "Diagnose"}
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-6 py-8 space-y-6">
        <Card className="border border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wifi className="h-5 w-5 text-teal-500" />
              Subscriber Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {infoRows.map(({ label, value }) => (
                <div
                  key={label}
                  className="p-4 rounded-xl bg-muted/50 border border-border"
                >
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className="font-medium text-foreground break-all">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Status Card */}
        <Card className="border border-border">
          <CardHeader>
            <CardTitle className="text-lg">Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold ${
                isUp
                  ? "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400"
                  : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isUp ? "bg-green-500" : "bg-red-500"}`} />
              {isUp ? "Subscriber is online" : "Subscriber is offline"}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Status is updated every 5 minutes by the BNG subscriber poll.
            </p>
          </CardContent>
        </Card>
      </main>

      {/* Edit Customer Modal */}
      <Dialog open={isEditOpen} onOpenChange={(open) => { setIsEditOpen(open); if (!open) setEditSuccess(false); }}>
        <DialogContent className="max-w-lg dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-teal-500" />
              Edit FTTH Customer
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="edit-customerID">Customer ID</Label>
              <Input
                id="edit-customerID"
                value={editData.customerID}
                onChange={(e) => setEditData((p) => ({ ...p, customerID: e.target.value }))}
                placeholder="e.g. C00001"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-customerName">Customer Name</Label>
              <Input
                id="edit-customerName"
                value={editData.customerName}
                onChange={(e) => setEditData((p) => ({ ...p, customerName: e.target.value }))}
                placeholder="Full name"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-homeNumber">Home Number</Label>
              <Input
                id="edit-homeNumber"
                value={editData.homeNumber}
                onChange={(e) => setEditData((p) => ({ ...p, homeNumber: e.target.value }))}
                placeholder="e.g. 0712345678"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-topUpExpiry">Top-Up Expiry</Label>
              <Input
                id="edit-topUpExpiry"
                type="date"
                value={editData.topUpExpiry}
                onChange={(e) => setEditData((p) => ({ ...p, topUpExpiry: e.target.value }))}
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border">
              <div>
                <p className="text-sm font-medium text-foreground">Free Customer</p>
                <p className="text-xs text-muted-foreground">Stops the daily expiry ping for this subscriber</p>
              </div>
              <Switch
                checked={editData.isFreeCustomer}
                onCheckedChange={(val) => setEditData((p) => ({ ...p, isFreeCustomer: val }))}
              />
            </div>

            {editError && (
              <div className="flex items-center gap-2 text-red-500 text-sm">
                <XCircle className="h-4 w-4 shrink-0" />
                {editError}
              </div>
            )}
            {editSuccess && (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Customer updated successfully.
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsEditOpen(false)} type="button">Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSaving} type="button" className="gap-2">
              {editSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diagnosis Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dark:text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-orange-500" />
              FTTH Diagnosis — {ip}
            </DialogTitle>
          </DialogHeader>

          {diagnosing ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              <p className="text-muted-foreground text-sm">Pinging {ip}... please wait</p>
            </div>
          ) : diagError ? (
            <div className="flex items-center gap-3 text-red-500 py-4">
              <XCircle className="h-5 w-5 shrink-0" />
              <p className="font-medium">{diagError}</p>
            </div>
          ) : diagResult ? (
            <div className="space-y-4 py-2">
              {/* Status badge */}
              <div className={`flex items-center gap-3 p-4 rounded-xl border ${
                diagResult.status === "active"
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-yellow-500/30 bg-yellow-500/5"
              }`}>
                {diagResult.status === "active"
                  ? <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" />
                  : <AlertCircle className="h-6 w-6 text-yellow-500 shrink-0" />}
                <p className="font-semibold text-foreground">{diagResult.message}</p>
              </div>

              {/* Expiry Info */}
              {diagResult.expiryInfo && (
                <div className={`p-4 rounded-xl border ${
                  diagResult.expiryInfo.status === "active"
                    ? "border-green-500/30 bg-green-500/5"
                    : diagResult.expiryInfo.status === "expired"
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-muted bg-muted/30"
                }`}>
                  <p className="text-xs text-muted-foreground mb-1">Service Expiry</p>
                  <p className={`font-semibold text-sm ${
                    diagResult.expiryInfo.status === "active"
                      ? "text-green-600 dark:text-green-400"
                      : diagResult.expiryInfo.status === "expired"
                      ? "text-red-500"
                      : "text-muted-foreground"
                  }`}>
                    {diagResult.expiryInfo.message}
                  </p>
                  {diagResult.expiryInfo.topUpExpiry && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Expiry date: {new Date(diagResult.expiryInfo.topUpExpiry).toLocaleDateString()}
                    </p>
                  )}
                  {diagResult.expiryInfo.status === "expired" && diagResult.expiryInfo.isFreeCustomer && (
                    <p className="text-xs text-blue-500 mt-1">Marked as free customer</p>
                  )}
                </div>
              )}

              {/* Not in Churn Report warning */}
              {diagResult.customerInfo?.notInInfo && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5">
                  <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
                  <p className="text-sm text-yellow-600 dark:text-yellow-400">
                    This customer is active on the network but has no record in the churn report.
                  </p>
                </div>
              )}

              {/* Ping stats */}
              {diagResult.pingResult && (
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  {[
                    { label: "Packet Loss", value: `${diagResult.pingResult.packetLoss}%` },
                    { label: "Min Latency", value: diagResult.pingResult.minLatency != null ? `${diagResult.pingResult.minLatency} ms` : "—" },
                    { label: "Avg Latency", value: diagResult.pingResult.avgLatency != null ? `${diagResult.pingResult.avgLatency} ms` : "—" },
                    { label: "Max Latency", value: diagResult.pingResult.maxLatency != null ? `${diagResult.pingResult.maxLatency} ms` : "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3 rounded-xl bg-muted/50 border border-border text-center">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-lg font-bold text-foreground mt-1">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Raw output */}
              {diagResult.rawOutput && (
                <details className="rounded-xl border border-border overflow-hidden">
                  <summary className="px-4 py-2 text-xs text-muted-foreground cursor-pointer hover:bg-muted/30 select-none">
                    Raw ping output
                  </summary>
                  <pre className="px-4 py-3 text-xs font-mono text-foreground bg-muted/20 overflow-x-auto whitespace-pre-wrap">
                    {diagResult.rawOutput}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">No diagnosis data.</div>
          )}

          <DialogFooter>
            <Button onClick={() => setIsModalOpen(false)} type="button">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ViewFTTHCustomer;
