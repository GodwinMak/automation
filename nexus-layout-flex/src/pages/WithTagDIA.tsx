import { useState, useEffect } from "react";
import { NetworkConfigFormWithTag } from "@/components/NetworkConfigFormWithTag";
import { Network, Tag } from "lucide-react";
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

const WithTagDIA = () => {
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
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/10">
              <Tag className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Junos Provisioning</h1>
              <p className="text-sm text-muted-foreground">DIA WITH TAG (VLAN) Customer Configuration</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto">
          {/* Page Header */}
          <div className="mb-8 animate-fade-in">
            <div className="flex items-center gap-2 text-purple-500 mb-2">
              <Network className="w-4 h-4" />
              <span className="text-sm font-medium uppercase tracking-wider">VLAN Tagged Setup</span>
            </div>
            <h2 className="text-3xl font-bold text-foreground mb-2">
              Configure Tagged Customer Circuit
            </h2>
            <p className="text-muted-foreground max-w-2xl">
              Configure DIA customers with VLAN tagging (flexible-vlan-tagging). 
              This setup uses vlan-ccc encapsulation on Metro and ethernet-vlan encapsulation on PE/BNG L2 circuits.
            </p>
          </div>

          {/* Info Box */}
          <div className="mb-8 p-4 rounded-lg bg-purple-500/10 border border-purple-500/30">
            <h3 className="font-medium text-purple-400 mb-2 flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Configuration Type: DIA WITH TAG
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li><strong>Metro Switch:</strong> flexible-vlan-tagging, encapsulation flexible-ethernet-services</li>
              <li><strong>Metro Unit:</strong> encapsulation vlan-ccc with vlan-id</li>
              <li><strong>PE/BNG:</strong> flexible-vlan-tagging, unit 0 (ethernet-ccc), numbered unit with vlan-id</li>
              <li><strong>L2Circuit:</strong> encapsulation-type ethernet-vlan, no-vlan-id-validate</li>
            </ul>
          </div>

          {/* Form */}
          <NetworkConfigFormWithTag devices={devices} setSearch={setSearch} loading={loading} />

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

export default WithTagDIA;

