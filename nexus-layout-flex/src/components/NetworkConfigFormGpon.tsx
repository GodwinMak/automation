import { useState } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSection } from "@/components/FormSection";
import { FormField } from "@/components/FormField";
import { PeDeviceInput } from "@/components/PeDeviceInput";
import { DeviceSearchInput } from "@/components/DeviceSearchInput";
import { toast } from "@/hooks/use-toast";
import {
  Server,
  Network,
  User,
  Settings,
  Shield,
  Loader2,
  Terminal,
  Eye,
  Split,
} from "lucide-react";

interface BngDevice {
  name: string;
  host: string;
}

interface FormData {
  accessSwitch: { name: string; host: string };
  accessIntf: string;
  bngDevices: BngDevice[];
  psUnit: string;
  vlanId: string;
  anchorPoint: string;
  profilePrefix: string;
  accountName: string;
  accountNumber: string;
  cid: string;
  mtu: string;
  username: string;
  password: string;
}

interface Device {
  id?: string;
  name: string;
  host: string;
}

interface NetworkConfigFormGponProps {
  devices: Device[];
  setSearch: (query: string) => void;
  loading?: boolean;
}

export const NetworkConfigFormGpon = ({
  devices,
  setSearch,
  loading = false,
}: NetworkConfigFormGponProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    accessSwitch: { name: "", host: "" },
    accessIntf: "",
    bngDevices: [
      { name: "", host: "" },
      { name: "", host: "" },
    ],
    psUnit: "",
    vlanId: "",
    anchorPoint: "lt-0/0/0",
    profilePrefix: "",
    accountName: "",
    accountNumber: "",
    cid: "",
    mtu: "1532",
    username: "",
    password: "",
  });

  const updateField = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);

  // Validate form data
  const validateForm = () => {
    const validBngDevices = formData.bngDevices.filter((bng) => bng.name && bng.host);

    if (!formData.accessSwitch.name || !formData.accessSwitch.host) {
      toast({
        title: "Validation Error",
        description: "Access Switch is required",
        variant: "destructive",
      });
      return null;
    }

    if (!formData.accessIntf) {
      toast({
        title: "Validation Error",
        description: "Access Switch interface is required",
        variant: "destructive",
      });
      return null;
    }

    if (validBngDevices.length < 2) {
      toast({
        title: "Validation Error",
        description: "At least 2 BNG devices are required (primary + backup)",
        variant: "destructive",
      });
      return null;
    }

    if (!formData.psUnit) {
      toast({
        title: "Validation Error",
        description: "PS Unit number is required",
        variant: "destructive",
      });
      return null;
    }

    if (!formData.vlanId) {
      toast({
        title: "Validation Error",
        description: "VLAN ID is required",
        variant: "destructive",
      });
      return null;
    }

    if (!formData.profilePrefix) {
      toast({
        title: "Validation Error",
        description: "Profile prefix is required (e.g. RAHA)",
        variant: "destructive",
      });
      return null;
    }

    if (!formData.accountName || !formData.accountNumber || !formData.cid) {
      toast({
        title: "Validation Error",
        description: "Account name, account number, and CID are required",
        variant: "destructive",
      });
      return null;
    }

    if (!formData.username || !formData.password) {
      toast({
        title: "Validation Error",
        description: "SSH credentials are required",
        variant: "destructive",
      });
      return null;
    }

    return validBngDevices;
  };

  // Preview configuration before pushing
  const handlePreview = async () => {
    const validBngDevices = formData.bngDevices.filter((bng) => bng.name && bng.host);

    if (!formData.accessSwitch.name || !formData.accessSwitch.host) {
      toast({
        title: "Validation Error",
        description: "Access Switch is required for preview",
        variant: "destructive",
      });
      return;
    }

    if (validBngDevices.length < 2) {
      toast({
        title: "Validation Error",
        description: "At least 2 BNG devices are required for preview",
        variant: "destructive",
      });
      return;
    }

    if (!formData.psUnit || !formData.vlanId || !formData.profilePrefix) {
      toast({
        title: "Validation Error",
        description: "PS Unit, VLAN ID and Profile Prefix are required for preview",
        variant: "destructive",
      });
      return;
    }

    setIsPreviewing(true);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/provisioning/preview-gpon-enterprise`, {
        ...formData,
        bngDevices: validBngDevices,
      });
      setPreviewData(res.data.preview);
      toast({
        title: "Preview Generated",
        description: "Configuration preview is ready. Review commands below.",
      });
    } catch (error: any) {
      toast({
        title: "Preview Failed",
        description: error.response?.data?.message || error.message,
        variant: "destructive",
      });
    } finally {
      setIsPreviewing(false);
    }
  };

  // Submit configuration
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validBngDevices = validateForm();
    if (!validBngDevices) return;

    setIsSubmitting(true);

    try {
      const configData = {
        ...formData,
        bngDevices: validBngDevices,
      };

      console.log("Pushing GPON OVER ENTERPRISE configuration:", configData);

      const res = await axios.post(`${PRODUCTION_URL}/provisioning/gpon-enterprise`, configData);

      toast({
        title: "Configuration Pushed Successfully!",
        description: `Configured ${formData.accountName} (${formData.accountNumber}) on Access Switch: ${formData.accessSwitch.name}`,
      });

      setPreviewData(null);
      console.log("Configuration result:", res.data);
    } catch (error: any) {
      console.error("Configuration error:", error);
      toast({
        title: "Configuration Failed",
        description: error.response?.data?.message || error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Access Switch Section */}
      <FormSection title="Access Switch" icon={<Server className="w-5 h-5" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Switch Name" htmlFor="access-name" required>
            <DeviceSearchInput
              devices={devices}
              value={formData.accessSwitch}
              onChange={(device) => updateField("accessSwitch", device)}
              onSearch={setSearch}
              loading={loading}
              placeholder="Search switch by name..."
            />
          </FormField>
          <FormField label="Host / IP Address" htmlFor="access-host" required>
            <Input
              id="access-host"
              placeholder="Auto-filled from search"
              value={formData.accessSwitch.host}
              readOnly
              className="bg-muted/50"
            />
          </FormField>
        </div>
        <FormField label="Access Interface" htmlFor="access-intf" required hint="e.g., ge-0/0/27">
          <Input
            id="access-intf"
            placeholder="ge-0/0/27"
            value={formData.accessIntf}
            onChange={(e) => updateField("accessIntf", e.target.value)}
          />
        </FormField>
      </FormSection>

      {/* BNG Devices Section */}
      <FormSection title="BNG Devices" icon={<Network className="w-5 h-5" />}>
        <PeDeviceInput
          devices={formData.bngDevices}
          onChange={(bngDevices) => updateField("bngDevices", bngDevices)}
          searchDevices={devices}
          onSearch={setSearch}
          loading={loading}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <FormField label="Anchor Point" htmlFor="anchor-point" required>
            <Input
              id="anchor-point"
              placeholder="e.g., lt-0/0/0"
              value={formData.anchorPoint}
              onChange={(e) => updateField("anchorPoint", e.target.value)}
              disabled
            />
          </FormField>
        </div>
      </FormSection>

      {/* GPON Configuration Section */}
      <FormSection title="GPON Configuration" icon={<Split className="w-5 h-5" />}>
        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 mb-4">
          <div className="flex items-center gap-2 text-purple-400 text-sm">
            <Split className="w-4 h-4" />
            <span className="font-medium">GPON over Enterprise Configuration</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            BNG uses auto-configure stacked-vlan-ranges (dynamic-profile / access-profile). Access Switch uses vlan-ccc encapsulation per VLAN unit.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="PS Unit Number"
            htmlFor="ps-unit"
            required
            hint="e.g., 127 - used for the ps interface on the BNG"
          >
            <Input
              id="ps-unit"
              type="number"
              placeholder="e.g., 127"
              value={formData.psUnit}
              onChange={(e) => updateField("psUnit", e.target.value)}
            />
          </FormField>
          <FormField
            label="VLAN ID"
            htmlFor="vlan-id"
            required
            hint="e.g., 101 - also used as the Access Switch unit number"
          >
            <Input
              id="vlan-id"
              type="number"
              placeholder="e.g., 101"
              value={formData.vlanId}
              onChange={(e) => updateField("vlanId", e.target.value)}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="Profile Prefix"
            htmlFor="profile-prefix"
            required
            hint='e.g., "RAHA" builds RAHA-GPON-VLAN-PROFILE / RAHA-GPON'
          >
            <Input
              id="profile-prefix"
              placeholder="e.g., RAHA"
              value={formData.profilePrefix}
              onChange={(e) => updateField("profilePrefix", e.target.value.toUpperCase())}
            />
          </FormField>
          <FormField label="L2Circuit MTU" htmlFor="mtu" hint="Default 1532">
            <Input
              id="mtu"
              type="number"
              placeholder="1532"
              value={formData.mtu}
              onChange={(e) => updateField("mtu", e.target.value)}
            />
          </FormField>
        </div>
        {formData.profilePrefix && (
          <div className="p-2 rounded bg-black/20 text-xs font-mono text-muted-foreground">
            <p>dynamic-profile: {formData.profilePrefix}-GPON-VLAN-PROFILE</p>
            <p>access-profile: {formData.profilePrefix}-GPON</p>
          </div>
        )}
      </FormSection>

      {/* Account Details Section */}
      <FormSection title="Account Details" icon={<User className="w-5 h-5" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Account Name" htmlFor="account-name" required>
            <Input
              id="account-name"
              placeholder="e.g., LYNY SUPPLY AND SERVICES"
              value={formData.accountName}
              onChange={(e) => updateField("accountName", e.target.value)}
            />
          </FormField>
          <FormField label="Account Number" htmlFor="account-number" required>
            <Input
              id="account-number"
              placeholder="e.g., LHTZ-6779"
              value={formData.accountNumber}
              onChange={(e) => updateField("accountNumber", e.target.value)}
            />
          </FormField>
        </div>
        <FormField
          label="Circuit ID (CID)"
          htmlFor="cid"
          required
          hint="Used to derive the virtual-circuit-id (255 prefix added automatically)"
        >
          <Input
            id="cid"
            placeholder="e.g., 000232"
            value={formData.cid}
            onChange={(e) => updateField("cid", e.target.value)}
          />
        </FormField>
      </FormSection>

      {/* Network Configuration Info */}
      <FormSection title="Network Configuration" icon={<Settings className="w-5 h-5" />}>
        {formData.bngDevices.length >= 2 && formData.bngDevices[1].host && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 mb-4">
            <div className="flex items-center gap-2 text-blue-400 text-sm">
              <Settings className="w-4 h-4" />
              <span className="font-medium">Backup Configuration</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Backup neighbor on the Access Switch will be auto-set to{" "}
              <span className="font-mono text-blue-400">{formData.bngDevices[1].host}</span> (from{" "}
              {formData.bngDevices[1].name || "BNG 2"})
            </p>
          </div>
        )}

        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <Network className="w-4 h-4" />
            <span className="font-medium">Configuration Summary</span>
          </div>
          <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
            <li>BNG: ps{formData.psUnit || "N"} with auto-configure stacked-vlan-ranges (unit 0, ethernet-ccc)</li>
            <li>Access Switch: {formData.accessIntf || "intf"} unit {formData.vlanId || "N"} (vlan-ccc, vlan-id {formData.vlanId || "N"})</li>
            <li>L2circuit: BNG uses no-vlan-id-validate; Access Switch uses encapsulation-type ethernet + backup-neighbor</li>
            <li>Same ps{formData.psUnit || "N"} config pushed to both primary and backup BNG</li>
          </ul>
        </div>
      </FormSection>

      {/* SSH Credentials Section */}
      <FormSection title="SSH Credentials" icon={<Shield className="w-5 h-5" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Username" htmlFor="ssh-username" required>
            <Input
              id="ssh-username"
              placeholder="admin"
              value={formData.username}
              onChange={(e) => updateField("username", e.target.value)}
            />
          </FormField>
          <FormField label="Password" htmlFor="ssh-password" required>
            <Input
              id="ssh-password"
              type="password"
              placeholder="••••••••"
              value={formData.password}
              onChange={(e) => updateField("password", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Preview Section */}
      {previewData && (
        <FormSection title="Configuration Preview" icon={<Eye className="w-5 h-5" />}>
          <div className="space-y-4">
            {/* Access Switch Commands */}
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <h4 className="font-medium text-green-400 mb-2">
                Access Switch: {previewData.accessSwitch?.device}
              </h4>
              <pre className="text-xs bg-black/50 p-3 rounded overflow-x-auto text-gray-300 font-mono whitespace-pre-wrap">
                {previewData.accessSwitch?.commands?.join("\n")}
              </pre>
            </div>

            {/* BNG Commands */}
            {previewData.bng?.map((bng: any, idx: number) => (
              <div
                key={idx}
                className={`p-4 rounded-lg ${
                  bng.role === "primary"
                    ? "bg-blue-500/10 border border-blue-500/30"
                    : "bg-amber-500/10 border border-amber-500/30"
                }`}
              >
                <h4
                  className={`font-medium mb-2 ${
                    bng.role === "primary" ? "text-blue-400" : "text-amber-400"
                  }`}
                >
                  {bng.role === "primary" ? "Primary" : "Backup"} BNG: {bng.device}
                </h4>
                <pre className="text-xs bg-black/50 p-3 rounded overflow-x-auto text-gray-300 font-mono whitespace-pre-wrap">
                  {bng.commands?.join("\n")}
                </pre>
              </div>
            ))}
          </div>
        </FormSection>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={isPreviewing || isSubmitting}
          onClick={handlePreview}
          className="min-w-[150px]"
        >
          {isPreviewing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Eye className="w-4 h-4" />
              Preview
            </>
          )}
        </Button>
        <Button type="submit" size="lg" disabled={isSubmitting || isPreviewing} className="min-w-[200px]">
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Pushing Config...
            </>
          ) : (
            <>
              <Terminal className="w-4 h-4" />
              Push Configuration
            </>
          )}
        </Button>
      </div>
    </form>
  );
};
