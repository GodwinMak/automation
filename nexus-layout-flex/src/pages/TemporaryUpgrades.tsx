import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { ReusableTable } from "@/components/Table";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Eye, Pencil } from "lucide-react";
import { PRODUCTION_URL } from "@/utils/Api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/hooks/useAuthContext";

// Every non-FTTH customer type that actually carries an upgrade_type column
// (see Models/customerinfo.js, iptcustomerinfo.js, L3VPNCustomerinfo.js).
// SHARED has no such column and L2VPN has no customerinfo/upgrade concept
// at all, so neither can ever appear in this list.
type CustomerType = "DIA" | "IPT" | "L3VPN";

const VIEW_ROUTE_BY_TYPE: Record<CustomerType, string> = {
  DIA: "/viewcustomer",
  IPT: "/view-ipt-customer",
  L3VPN: "/view-l3vpn-customer",
};

const NESTED_KEY_BY_TYPE: Record<CustomerType, string> = {
  DIA: "diacustomer",
  IPT: "iptcustomer",
  L3VPN: "l3vpncustomer",
};

const BADGE_VARIANT_BY_TYPE: Record<CustomerType, "default" | "secondary" | "outline"> = {
  DIA: "default",
  IPT: "secondary",
  L3VPN: "outline",
};

interface TemporaryUpgradeCustomer {
  id: string;
  customerType: CustomerType;
  customerName: string;
  interface: string;
  nbr: string;
  upmbps: number | null;
  downmbps: number | null;
  expires_at: string | null;
  [nestedKey: string]: unknown;
}

type EditMode = "temporary" | "permanent";

interface EditFormState {
  type: EditMode;
  expiryMode: "duration" | "date";
  duration: string;
  expires_at: string;
  new_upmbps: string;
  new_downmbps: string;
  password: string;
}

const EDIT_ENDPOINT_BY_TYPE: Record<CustomerType, string> = {
  DIA: `${PRODUCTION_URL}/upgrade/temporary/edit`,
  IPT: `${PRODUCTION_URL}/upgrade/ipt/temporary/edit`,
  L3VPN: `${PRODUCTION_URL}/upgrade/l3vpn/temporary/edit`,
};

const formatRemainingTime = (expiresAt: string | null) => {
  if (!expiresAt) return "No expiry";

  const now = new Date();
  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime())) return "Invalid expiry";

  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs <= 0) return "Expired";

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const TemporaryUpgrades = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { authState } = useAuthContext();
  const [customers, setCustomers] = useState<TemporaryUpgradeCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<TemporaryUpgradeCustomer | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    type: "temporary",
    expiryMode: "duration",
    duration: "1d",
    expires_at: "",
    new_upmbps: "",
    new_downmbps: "",
    password: "",
  });

  const fetchTemporaryUpgrades = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/status/temporary-upgrades`);
      setCustomers(res.data.customers || []);
    } catch (err) {
      console.error("Error fetching temporary upgrades:", err);
      toast({
        title: "Failed to fetch temporary upgrades",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemporaryUpgrades();
  }, []);

  const openEditDialog = (customer: TemporaryUpgradeCustomer) => {
    setSelectedCustomer(customer);
    setEditForm({
      type: "temporary",
      expiryMode: "duration",
      duration: "1d",
      expires_at: customer.expires_at ? new Date(customer.expires_at).toISOString().slice(0, 16) : "",
      new_upmbps: customer.upmbps != null ? String(customer.upmbps) : "",
      new_downmbps: customer.downmbps != null ? String(customer.downmbps) : "",
      password: "",
    });
    setEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    const username = authState?.userData?.username;
    if (!username) {
      toast({ title: "Authentication error: username not found", variant: "destructive" });
      return;
    }

    const currentUp = selectedCustomer.upmbps ?? 0;
    const currentDown = selectedCustomer.downmbps ?? 0;
    const nextUp = Number(editForm.new_upmbps);
    const nextDown = Number(editForm.new_downmbps);
    const isCapacityChanged = nextUp !== currentUp || nextDown !== currentDown;

    if (!Number.isFinite(nextUp) || !Number.isFinite(nextDown) || nextUp <= 0 || nextDown <= 0) {
      toast({ title: "Capacity must be positive numbers", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      interface: selectedCustomer.interface,
      type: editForm.type,
      new_upmbps: nextUp,
      new_downmbps: nextDown,
    };

    if (editForm.type === "temporary") {
      if (editForm.expiryMode === "duration") {
        if (!editForm.duration.trim()) {
          toast({ title: "Duration is required", variant: "destructive" });
          return;
        }
        payload.duration = editForm.duration.trim();
      } else {
        if (!editForm.expires_at) {
          toast({ title: "End date is required", variant: "destructive" });
          return;
        }
        payload.expires_at = new Date(editForm.expires_at).toISOString();
      }
    }

    if (isCapacityChanged) {
      if (!editForm.password) {
        toast({ title: "Password required for capacity changes", variant: "destructive" });
        return;
      }
      payload.username = username;
      payload.password = editForm.password;
    }

    setEditLoading(true);
    try {
      await axios.put(EDIT_ENDPOINT_BY_TYPE[selectedCustomer.customerType], payload);
      toast({ title: "Temporary upgrade updated successfully" });
      setEditOpen(false);
      setSelectedCustomer(null);
      await fetchTemporaryUpgrades();
    } catch (err: any) {
      console.error("Error editing temporary upgrade:", err);
      toast({
        title: err?.response?.data?.message || "Failed to update temporary upgrade",
        variant: "destructive",
      });
    } finally {
      setEditLoading(false);
    }
  };

  const columns = [
    {
      key: "customerType" as const,
      label: "Type",
      render: (customer: TemporaryUpgradeCustomer) => (
        <Badge variant={BADGE_VARIANT_BY_TYPE[customer.customerType]}>{customer.customerType}</Badge>
      ),
    },
    { key: "customerName" as const, label: "Customer Name" },
    { key: "interface" as const, label: "Interface" },
    { key: "nbr" as const, label: "Neighbor" },
    {
      key: "upmbps" as const,
      label: "Capacity (Mbps)",
      render: (customer: TemporaryUpgradeCustomer) =>
        `${customer.upmbps ?? "-"} / ${customer.downmbps ?? "-"}`,
    },
    {
      key: "operationalStatus" as const,
      label: "Status",
      render: (customer: TemporaryUpgradeCustomer) => {
        const nested = customer[NESTED_KEY_BY_TYPE[customer.customerType]] as
          | { operationalStatus?: string }
          | undefined;
        return nested?.operationalStatus ?? "-";
      },
    },
    {
      key: "expires_at" as const,
      label: "Remaining Time",
      render: (customer: TemporaryUpgradeCustomer) => formatRemainingTime(customer.expires_at),
    },
  ];

  const Action = (customer: TemporaryUpgradeCustomer) => (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => navigate(VIEW_ROUTE_BY_TYPE[customer.customerType], { state: { customer } })}
      >
        <Eye className="h-4 w-4" />
        View Customer
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => openEditDialog(customer)}
      >
        <Pencil className="h-4 w-4" />
        Edit Temporary
      </DropdownMenuItem>
    </>
  );

  return (
    <div className="p-6">
      <ReusableTable
        title="Temporary Upgrades"
        description="Every non-FTTH customer currently on a temporary bandwidth upgrade"
        columns={columns}
        data={customers}
        actions={Action}
        loading={loading}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Temporary Upgrade</DialogTitle>
            <DialogDescription>
              Update capacity, extend/change end date, or convert this temporary change to permanent.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleEditSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Interface</label>
              <Input value={selectedCustomer?.interface || ""} readOnly />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Upload Mbps</label>
                <Input
                  type="number"
                  min="1"
                  value={editForm.new_upmbps}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, new_upmbps: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Download Mbps</label>
                <Input
                  type="number"
                  min="1"
                  value={editForm.new_downmbps}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, new_downmbps: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Change Type</label>
              <Select
                value={editForm.type}
                onValueChange={(value: EditMode) => setEditForm((prev) => ({ ...prev, type: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="temporary">Temporary</SelectItem>
                  <SelectItem value="permanent">Permanent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editForm.type === "temporary" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">End Date Input Mode</label>
                  <Select
                    value={editForm.expiryMode}
                    onValueChange={(value: "duration" | "date") =>
                      setEditForm((prev) => ({ ...prev, expiryMode: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select expiry mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="duration">Duration</SelectItem>
                      <SelectItem value="date">Exact End Date</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {editForm.expiryMode === "duration" ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Duration (example: 12h, 3d)</label>
                    <Input
                      value={editForm.duration}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, duration: e.target.value }))}
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">New End Date</label>
                    <Input
                      type="datetime-local"
                      value={editForm.expires_at}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, expires_at: e.target.value }))}
                    />
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Password (required only if capacity changed)</label>
              <Input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={editLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TemporaryUpgrades;
