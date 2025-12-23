import { useState, useEffect, useCallback } from "react";
import { NetworkConfigForm } from "@/components/NetworkConfigForm";
import { Network, Zap } from "lucide-react";
import { PRODUCTION_URL } from "@/utils/Api";
import axios from "axios";

// Debounce hook
const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
};

const NonTagDIA = () => {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState([]);
  
  // Debounce search query by 300ms
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    const fetchDevices = async () => {
      if (!debouncedSearch) {
        setDevices([]);
        return;
      }
      
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/devices?search=${debouncedSearch}`
        );
        console.log(res.data);
        setDevices(res.data.devices || []);
      } catch (err) {
        console.error("Error fetching devices:", err);
        setDevices([]);
      } finally {
        setLoading(false);
      }
    };
    fetchDevices();
  }, [debouncedSearch]);
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 glow-primary">
              <Network className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Junos Provisioning</h1>
              <p className="text-sm text-muted-foreground">DIA NO TAG Customer Configuration</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className=" mx-auto">
          {/* Page Header */}
          <div className="mb-8 animate-fade-in">
            <div className="flex items-center gap-2 text-primary mb-2">
              <Zap className="w-4 h-4" />
              <span className="text-sm font-medium uppercase tracking-wider">New Customer Setup</span>
            </div>
            <h2 className="text-3xl font-bold text-foreground mb-2">
              Configure Customer Circuit
            </h2>
            <p className="text-muted-foreground max-w-2xl">
              Fill in the details below to push L2 circuit and interface configuration to your Metro switches and PE/BNG devices via SSH.
            </p>
          </div>

          {/* Form */}
          <NetworkConfigForm devices={devices} setSearch={setSearch} loading={loading} />

          {/* Footer Info */}
          <div className="mt-12 p-4 rounded-lg bg-secondary/30 border border-border">
            <p className="text-sm text-muted-foreground text-center">
              Configuration will be pushed using <code className="font-mono text-primary px-1.5 py-0.5 bg-primary/10 rounded">configure private</code> mode with commit check before final commit.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default NonTagDIA;
