import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/FormField";
import { DeviceSearchInput } from "@/components/DeviceSearchInput";
import { Plus, X } from "lucide-react";

interface PeDevice {
  name: string;
  host: string;
}

interface SearchDevice {
  id?: string;
  name: string;
  host: string;
}

interface PeDeviceInputProps {
  devices: PeDevice[];
  onChange: (devices: PeDevice[]) => void;
  searchDevices: SearchDevice[];
  onSearch: (query: string) => void;
  loading?: boolean;
  minDevices?: number; // Minimum number of devices required
}

export const PeDeviceInput = ({ 
  devices, 
  onChange, 
  searchDevices, 
  onSearch, 
  loading = false,
  minDevices = 2  // Default: require at least 2 for primary + backup
}: PeDeviceInputProps) => {
  const addDevice = () => {
    onChange([...devices, { name: "", host: "" }]);
  };

  const removeDevice = (index: number) => {
    // Prevent removing below minimum devices
    if (devices.length <= minDevices) return;
    onChange(devices.filter((_, i) => i !== index));
  };

  const updateDevice = (index: number, device: PeDevice) => {
    const updated = devices.map((d, i) =>
      i === index ? device : d
    );
    onChange(updated);
  };

  // Get label for device role
  const getDeviceLabel = (index: number) => {
    if (index === 0) return "Primary PE/BNG";
    if (index === 1) return "Backup PE/BNG";
    return `PE/BNG ${index + 1}`;
  };

  return (
    <div className="space-y-4">
      {/* Info message */}
      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm">
        <p className="text-amber-400">
          <strong>Note:</strong> First device = Primary, Second device = Backup. 
          Same config will be pushed to both PE/BNG devices.
        </p>
      </div>

      {devices.map((device, index) => (
        <div 
          key={index} 
          className={`flex gap-3 items-start p-4 rounded-lg border ${
            index === 0 
              ? "bg-green-500/5 border-green-500/30" 
              : index === 1 
                ? "bg-blue-500/5 border-blue-500/30" 
                : "bg-secondary/50 border-border"
          }`}
        >
          <div className="flex-1">
            {/* Device role label */}
            <div className={`text-xs font-medium mb-2 ${
              index === 0 ? "text-green-400" : index === 1 ? "text-blue-400" : "text-muted-foreground"
            }`}>
              {getDeviceLabel(index)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FormField label="Device Name" htmlFor={`pe-name-${index}`} required>
                <DeviceSearchInput
                  devices={searchDevices}
                  value={device}
                  onChange={(d) => updateDevice(index, d)}
                  onSearch={onSearch}
                  loading={loading}
                  placeholder="Search PE/BNG by name..."
                />
              </FormField>
              <FormField label="Host/IP" htmlFor={`pe-host-${index}`} required>
                <Input
                  id={`pe-host-${index}`}
                  placeholder="Auto-filled from search"
                  value={device.host}
                  readOnly
                  className="bg-muted/50"
                />
              </FormField>
            </div>
          </div>
          {/* Only show remove button if above minimum devices */}
          {devices.length > minDevices && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeDevice(index)}
              className="mt-8 text-muted-foreground hover:text-destructive"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addDevice} className="gap-2">
        <Plus className="w-4 h-4" />
        Add Additional PE/BNG
      </Button>
    </div>
  );
};
