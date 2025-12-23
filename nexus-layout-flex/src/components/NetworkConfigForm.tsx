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
} from "lucide-react";

interface PeDevice {
  name: string;
  host: string;
}

interface FormData {
  metroSwitch: { name: string; host: string };
  peDevices: PeDevice[];
  metroIntf: string;
  peIntf: string;
  anchorPoint: string;
  customerName: string;
  cid: string;
  mbps: string;
  wanIp: string;
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

interface NetworkConfigFormProps {
  devices: Device[];
  setSearch: (query: string) => void;
  loading?: boolean;
}

export const NetworkConfigForm = ({ devices, setSearch, loading = false }: NetworkConfigFormProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    metroSwitch: { name: "", host: "" },
    // Start with 2 PE/BNG devices: Primary and Backup
    peDevices: [
      { name: "", host: "" },  // Primary PE/BNG
      { name: "", host: "" },  // Backup PE/BNG
    ],
    metroIntf: "",
    peIntf: "",
    anchorPoint: "lt-0/0/0",
    customerName: "",
    cid: "",
    mbps: "",
    wanIp: "",
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

    setIsPreviewing(true);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/provisioning/preview`, {
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

      console.log("Pushing configuration:", configData);

      const res = await axios.post(`${PRODUCTION_URL}/provisioning/dia-no-tag`, configData);
      
      toast({
        title: "Configuration Pushed Successfully!",
        description: `Configured ${formData.customerName} on Metro: ${formData.metroSwitch.name}, Primary PE: ${validPeDevices[0].name}, Backup PE: ${validPeDevices[1].name}`,
      });

      // Clear preview after successful push
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
        <FormField label="Metro Interface" htmlFor="metro-intf" required hint="e.g., ge-0/0/1">
          <Input
            id="metro-intf"
            placeholder="ge-0/0/1"
            value={formData.metroIntf}
            onChange={(e) => updateField("metroIntf", e.target.value)}
          />
        </FormField>
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
          <FormField label="PS Interface" htmlFor="pe-intf" required hint="e.g., psxxxx">
            <Input
              id="pe-intf"
              placeholder="psxxxx"
              value={formData.peIntf}
              onChange={(e) => updateField("peIntf", e.target.value)}
            />
          </FormField>
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

      {/* Customer Details Section */}
      <FormSection title="Customer Details" icon={<User className="w-5 h-5" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Customer Name" htmlFor="customer-name" required>
            <Input
              id="customer-name"
              placeholder="e.g., Acme Corporation"
              value={formData.customerName}
              onChange={(e) => updateField("customerName", e.target.value)}
            />
          </FormField>
          <FormField label="Circuit ID (CID)" htmlFor="cid" required>
            <Input
              id="cid"
              placeholder="e.g., CID-12345"
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
              placeholder="e.g., 100"
              value={formData.mbps}
              onChange={(e) => updateField("mbps", e.target.value)}
            />
          </FormField>
          <FormField label="WAN IP" htmlFor="wan-ip" required hint="Customer WAN IP address">
            <Input
              id="wan-ip"
              placeholder="e.g., 203.0.113.1/30"
              value={formData.wanIp}
              onChange={(e) => updateField("wanIp", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Network Configuration Section */}
      <FormSection title="Network Configuration" icon={<Settings className="w-5 h-5" />}>
        {/* Backup IP Info - Auto-calculated from second PE/BNG */}
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

        <div className="flex items-center space-x-3 py-2">
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
            Include Internal Subnet Route
          </label>
        </div>

        {formData.includeInternalSubnet && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-secondary/50 border border-border animate-fade-in">
            <FormField label="Internal Subnet" htmlFor="internal-subnet" required>
              <Input
                id="internal-subnet"
                placeholder="e.g., 192.168.1.0/24"
                value={formData.internalSubnet}
                onChange={(e) => updateField("internalSubnet", e.target.value)}
              />
            </FormField>
            <FormField label="Next Hop" htmlFor="internal-next-hop" required>
              <Input
                id="internal-next-hop"
                placeholder="e.g., 192.168.1.1"
                value={formData.internalNextHop}
                onChange={(e) => updateField("internalNextHop", e.target.value)}
              />
            </FormField>
          </div>
        )}
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
                Metro Switch: {previewData.metro?.device?.name}
              </h4>
              <pre className="text-xs bg-black/50 p-3 rounded overflow-x-auto text-gray-300 font-mono">
                {previewData.metro?.commands?.join("\n")}
              </pre>
            </div>

            {/* Primary PE Commands */}
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <h4 className="font-medium text-blue-400 mb-2">
                Primary PE/BNG: {previewData.primaryPe?.device?.name}
              </h4>
              <pre className="text-xs bg-black/50 p-3 rounded overflow-x-auto text-gray-300 font-mono">
                {previewData.primaryPe?.commands?.join("\n")}
              </pre>
            </div>

            {/* Backup PE Commands */}
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <h4 className="font-medium text-amber-400 mb-2">
                Backup PE/BNG: {previewData.backupPe?.device?.name}
              </h4>
              <pre className="text-xs bg-black/50 p-3 rounded overflow-x-auto text-gray-300 font-mono">
                {previewData.backupPe?.commands?.join("\n")}
              </pre>
            </div>
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
