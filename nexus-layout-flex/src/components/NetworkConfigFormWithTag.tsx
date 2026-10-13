import { useState } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  Tag,
  Route,
} from "lucide-react";

interface PeDevice {
  name: string;
  host: string;
}

interface FormData {
  metroSwitch: { name: string; host: string };
  peDevices: PeDevice[];
  metroIntf: string;
  psUnit: string;
  vlanId: string;
  anchorPoint: string;
  customerName: string;
  cid: string;
  mbps: string;
  wanIp: string;
  sharedPort: boolean;
  includeInternalSubnet: boolean;
  internalSubnet: string;
  internalNextHop: string;
  username: string;
  password: string;
}

interface Device {
  id?: string;
  name: string;
  host: string;
}

interface NetworkConfigFormWithTagProps {
  devices: Device[];
  setSearch: (query: string) => void;
  loading?: boolean;
}

export const NetworkConfigFormWithTag = ({ 
  devices, 
  setSearch, 
  loading = false 
}: NetworkConfigFormWithTagProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    metroSwitch: { name: "", host: "" },
    peDevices: [
      { name: "", host: "" },
      { name: "", host: "" },
    ],
    metroIntf: "",
    psUnit: "",
    vlanId: "",
    anchorPoint: "lt-0/0/0",
    customerName: "",
    cid: "",
    mbps: "",
    wanIp: "",
    sharedPort: false,
    includeInternalSubnet: false,
    internalSubnet: "",
    internalNextHop: "",
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
    const validPeDevices = formData.peDevices.filter(pe => pe.name && pe.host);
    
    if (!formData.metroSwitch.name || !formData.metroSwitch.host) {
      toast({
        title: "Validation Error",
        description: "Metro Switch is required",
        variant: "destructive",
      });
      return null;
    }

    if (validPeDevices.length < 2) {
      toast({
        title: "Validation Error",
        description: "At least 2 PE/BNG devices are required (primary + backup)",
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

    if (!formData.username || !formData.password) {
      toast({
        title: "Validation Error",
        description: "SSH credentials are required",
        variant: "destructive",
      });
      return null;
    }

    return validPeDevices;
  };

  // Preview configuration before pushing
  const handlePreview = async () => {
    const validPeDevices = formData.peDevices.filter(pe => pe.name && pe.host);
    
    if (validPeDevices.length < 2) {
      toast({
        title: "Validation Error",
        description: "At least 2 PE/BNG devices are required for preview",
        variant: "destructive",
      });
      return;
    }

    if (!formData.psUnit || !formData.vlanId) {
      toast({
        title: "Validation Error",
        description: "PS Unit and VLAN ID are required for preview",
        variant: "destructive",
      });
      return;
    }

    setIsPreviewing(true);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/provisioning/preview-with-tag`, {
        ...formData,
        peDevices: validPeDevices,
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

    const validPeDevices = validateForm();
    if (!validPeDevices) return;

    setIsSubmitting(true);

    try {
      const configData = {
        ...formData,
        peDevices: validPeDevices,
      };

      console.log("Pushing DIA WITH TAG configuration:", configData);

      const res = await axios.post(`${PRODUCTION_URL}/provisioning/dia-with-tag`, configData);
      
      toast({
        title: "Configuration Pushed Successfully!",
        description: `Configured ${formData.customerName} with VLAN ${formData.vlanId} on Metro: ${formData.metroSwitch.name}`,
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
      {/* Metro Switch Section */}
      <FormSection title="Metro Switch" icon={<Server className="w-5 h-5" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Switch Name" htmlFor="metro-name" required>
            <DeviceSearchInput
              devices={devices}
              value={formData.metroSwitch}
              onChange={(device) => updateField("metroSwitch", device)}
              onSearch={setSearch}
              loading={loading}
              placeholder="Search switch by name..."
            />
          </FormField>
          <FormField label="Host / IP Address" htmlFor="metro-host" required>
            <Input
              id="metro-host"
              placeholder="Auto-filled from search"
              value={formData.metroSwitch.host}
              readOnly
              className="bg-muted/50"
            />
          </FormField>
        </div>
        <FormField label="Metro Interface" htmlFor="metro-intf" required hint="e.g., ge-0/0/77">
          <Input
            id="metro-intf"
            placeholder="ge-0/0/77"
            value={formData.metroIntf}
            onChange={(e) => updateField("metroIntf", e.target.value)}
          />
        </FormField>
        <div className="flex items-center gap-2 pt-2">
          <Checkbox
            id="shared-port"
            checked={formData.sharedPort}
            onCheckedChange={(checked) =>
              updateField("sharedPort", checked as boolean)
            }
          />
          <label htmlFor="shared-port" className="text-sm text-muted-foreground cursor-pointer">
            Port is already shared with another customer (skip physical interface commands, add unit only)
          </label>
        </div>
      </FormSection>

      {/* PE/BNG Devices Section */}
      <FormSection title="PE/BNG Devices" icon={<Network className="w-5 h-5" />}>
        <PeDeviceInput
          devices={formData.peDevices}
          onChange={(peDevices) => updateField("peDevices", peDevices)}
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

      {/* VLAN Configuration Section - NEW */}
      <FormSection title="VLAN Configuration" icon={<Tag className="w-5 h-5" />}>
        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 mb-4">
          <div className="flex items-center gap-2 text-purple-400 text-sm">
            <Tag className="w-4 h-4" />
            <span className="font-medium">Tagged VLAN Configuration</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            This configuration uses flexible-vlan-tagging with encapsulation vlan-ccc
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField 
            label="PS Unit Number" 
            htmlFor="ps-unit" 
            required 
            hint="e.g., 1853 - used for interface unit and PS name"
          >
            <Input
              id="ps-unit"
              type="number"
              placeholder="e.g., 1853"
              value={formData.psUnit}
              onChange={(e) => updateField("psUnit", e.target.value)}
            />
          </FormField>
          <FormField 
            label="VLAN ID" 
            htmlFor="vlan-id" 
            required 
            hint="e.g., 990 - customer VLAN tag"
          >
            <Input
              id="vlan-id"
              type="number"
              placeholder="e.g., 990"
              value={formData.vlanId}
              onChange={(e) => updateField("vlanId", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Customer Details Section */}
      <FormSection title="Customer Details" icon={<User className="w-5 h-5" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Customer Name" htmlFor="customer-name" required>
            <Input
              id="customer-name"
              placeholder="e.g., Auto Xpress - Head Office"
              value={formData.customerName}
              onChange={(e) => updateField("customerName", e.target.value)}
            />
          </FormField>
          <FormField label="Circuit ID (CID)" htmlFor="cid" required>
            <Input
              id="cid"
              placeholder="e.g., 2551900041"
              value={formData.cid}
              onChange={(e) => updateField("cid", e.target.value)}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Bandwidth (Mbps)" htmlFor="mbps" required>
            <Input
              id="mbps"
              type="number"
              placeholder="e.g., 8"
              value={formData.mbps}
              onChange={(e) => updateField("mbps", e.target.value)}
            />
          </FormField>
          <FormField label="WAN IP" htmlFor="wan-ip" required hint="Customer WAN IP address">
            <Input
              id="wan-ip"
              placeholder="e.g., 154.72.95.133/30"
              value={formData.wanIp}
              onChange={(e) => updateField("wanIp", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Network Configuration Info */}
      <FormSection title="Network Configuration" icon={<Settings className="w-5 h-5" />}>
        {formData.peDevices.length >= 2 && formData.peDevices[1].host && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 mb-4">
            <div className="flex items-center gap-2 text-blue-400 text-sm">
              <Settings className="w-4 h-4" />
              <span className="font-medium">Backup Configuration</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Backup IP will be auto-set to <span className="font-mono text-blue-400">{formData.peDevices[1].host}</span> (from {formData.peDevices[1].name || "PE/BNG 2"})
            </p>
          </div>
        )}

        {/* Internal Subnet Option */}
        <div className="flex items-center space-x-3 py-2 mb-4">
          <Checkbox
            id="include-subnet"
            checked={formData.includeInternalSubnet}
            onCheckedChange={(checked) =>
              updateField("includeInternalSubnet", checked as boolean)
            }
          />
          <label
            htmlFor="include-subnet"
            className="text-sm font-medium leading-none cursor-pointer text-foreground"
          >
            Include Customer Internal Subnet Route
          </label>
        </div>

        {formData.includeInternalSubnet && (
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-4 animate-fade-in">
            <div className="flex items-center gap-2 text-amber-400 text-sm mb-3">
              <Route className="w-4 h-4" />
              <span className="font-medium">Internal Subnet Configuration</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Adds static route and RR-BGP-out STATIC term for customer internal subnet
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Internal Subnet" htmlFor="internal-subnet" required>
                <Input
                  id="internal-subnet"
                  placeholder="e.g., 154.72.95.152/29"
                  value={formData.internalSubnet}
                  onChange={(e) => updateField("internalSubnet", e.target.value)}
                />
              </FormField>
              <FormField label="Next Hop" htmlFor="internal-next-hop" required>
                <Input
                  id="internal-next-hop"
                  placeholder="e.g., 154.72.95.134"
                  value={formData.internalNextHop}
                  onChange={(e) => updateField("internalNextHop", e.target.value)}
                />
              </FormField>
            </div>
            <div className="mt-3 p-2 rounded bg-black/20 text-xs font-mono text-muted-foreground">
              <p>set routing-options static route {formData.internalSubnet || "<subnet>"} next-hop {formData.internalNextHop || "<next-hop>"}</p>
              <p>set policy-options policy-statement RR-BGP-out term STATIC from route-filter {formData.internalSubnet || "<subnet>"} exact</p>
            </div>
          </div>
        )}
        
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <Network className="w-4 h-4" />
            <span className="font-medium">Configuration Summary</span>
          </div>
          <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
            <li>Metro: flexible-vlan-tagging with vlan-ccc encapsulation</li>
            <li>PE: Unit 0 (ethernet-ccc) + Unit {formData.psUnit || "N"} (VLAN {formData.vlanId || "N"})</li>
            <li>L2circuit with ethernet-vlan encapsulation and no-vlan-id-validate</li>
            <li>Policer: {formData.mbps || "N"}-MBPS-POLICER (input/output)</li>
            {formData.includeInternalSubnet && formData.internalSubnet && (
              <li className="text-amber-400">Internal subnet: {formData.internalSubnet} via {formData.internalNextHop}</li>
            )}
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
            {/* Metro Switch Commands */}
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <h4 className="font-medium text-green-400 mb-2">
                Metro Switch: {previewData.metro?.device}
              </h4>
              <pre className="text-xs bg-black/50 p-3 rounded overflow-x-auto text-gray-300 font-mono whitespace-pre-wrap">
                {previewData.metro?.commands?.join("\n")}
              </pre>
            </div>

            {/* PE/BNG Commands */}
            {previewData.pe?.map((pe: any, idx: number) => (
              <div 
                key={idx}
                className={`p-4 rounded-lg ${
                  pe.role === "primary" 
                    ? "bg-blue-500/10 border border-blue-500/30" 
                    : "bg-amber-500/10 border border-amber-500/30"
                }`}
              >
                <h4 className={`font-medium mb-2 ${
                  pe.role === "primary" ? "text-blue-400" : "text-amber-400"
                }`}>
                  {pe.role === "primary" ? "Primary" : "Backup"} PE/BNG: {pe.device}
                </h4>
                <pre className="text-xs bg-black/50 p-3 rounded overflow-x-auto text-gray-300 font-mono whitespace-pre-wrap">
                  {pe.commands?.join("\n")}
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
        <Button 
          type="submit" 
          size="lg" 
          disabled={isSubmitting || isPreviewing} 
          className="min-w-[200px]"
        >
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

