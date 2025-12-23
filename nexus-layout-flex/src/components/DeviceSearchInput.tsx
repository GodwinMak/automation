import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search, Server, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Device {
  id?: string;
  name: string;
  host?: string;
  ip?: string; // API returns 'ip' field
  [key: string]: any;
}

interface DeviceSearchInputProps {
  devices: Device[];
  value: { name: string; host: string };
  onChange: (device: { name: string; host: string }) => void;
  onSearch: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  label?: string;
}

// Helper to get IP/host from device (API uses 'ip', form uses 'host')
const getDeviceHost = (device: Device): string => {
  return device.host || device.ip || "";
};

export const DeviceSearchInput = ({
  devices,
  value,
  onChange,
  onSearch,
  loading = false,
  placeholder = "Search device...",
}: DeviceSearchInputProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(value.name || "");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync search query with value when value changes externally
  useEffect(() => {
    if (value.name && value.name !== searchQuery) {
      setSearchQuery(value.name);
    }
  }, [value.name]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    setIsOpen(true);
    onSearch(query);
  };

  const handleSelectDevice = (device: Device) => {
    // Map 'ip' from API to 'host' for form
    const host = getDeviceHost(device);
    console.log("Selected device:", device.name, "Host/IP:", host);
    onChange({ name: device.name, host });
    setSearchQuery(device.name);
    setIsOpen(false);
  };

  const handleFocus = () => {
    setIsOpen(true);
    if (searchQuery) {
      onSearch(searchQuery);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={handleFocus}
          className="pl-9 pr-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-[300px] overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Searching...
            </div>
          ) : devices.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              {searchQuery ? "No devices found" : "Type to search devices"}
            </div>
          ) : (
            <ul className="py-1">
              {devices.map((device, index) => {
                const deviceHost = getDeviceHost(device);
                return (
                  <li
                    key={device.id || `${device.name}-${index}`}
                    onClick={() => handleSelectDevice(device)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent transition-colors",
                      value.name === device.name && "bg-accent"
                    )}
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
                      <Server className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{device.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{deviceHost}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

