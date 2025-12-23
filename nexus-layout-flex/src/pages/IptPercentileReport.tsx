import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileSpreadsheet, Download, Search, Loader2, AlertCircle, CheckCircle2, Clock, RefreshCw, Database, LineChart } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface CustomerReport {
  id: string;
  customerName: string;
  nbr: string;
  port: string;
  switchName: string;
  interface: string;
  capacity: number;
  p95Sent: number | null;
  p95Recv: number | null;
  p95Billing: number | null;
  unit: string;
  status: "pending" | "loading" | "success" | "error";
  error?: string;
  dataSource?: "history" | "trends";
  samples?: number;
  usedSwitch?: string; // The switch that data was fetched from (may differ if fallback used)
}

// Zabbix API helper
const zabbixApi = async (payload: any) => {
  const res = await axios.post(
    "https://monitoring.liquidtelecom.net/api_jsonrpc.php",
    {
      jsonrpc: "2.0",
      ...payload,
    },
    {
      headers: { "Content-Type": "application/json", "Authorization": undefined, },
    }
  );
  return res.data.result;
};

// Map switch names to Zabbix host names
const getZabbixHostName = (switchName: string) => {
  // Known explicit mappings
  const hostMapping: Record<string, string> = {
    "LTZ-PE1-RAH": "lo-0.ltz-pe1-rah.liquidtelecom.net",
    "LTZ-P1-DAR": "lo-0.ltz-p1-dar.liquidtelecom.net",
  };
  
  // If explicit mapping exists, use it
  if (hostMapping[switchName]) {
    return hostMapping[switchName];
  }
  
  return switchName;
};

// Calculate 95th percentile using exact Zabbix method
// const calcP95 = (values: number[]) => {
//   if (!values.length) return 0;
  
//   const sorted = [...values].sort((a, b) => a - b);
//   const n = sorted.length;
  
//   // Zabbix calculation method:
//   // 1. Calculate position = n * 0.95
//   // 2. If NOT whole number: round UP, use value at that position
//   // 3. If IS whole number: average of value at position and position+1
  
//   const position = n * 0.95;
  
//   if (position % 1 !== 0) {
//     // Not a whole number - round UP and use that index (1-based to 0-based)
//     const index = Math.ceil(position) - 1;
//     return sorted[Math.min(index, n - 1)];
//   } else {
//     // Whole number - average of position and position+1 (1-based to 0-based)
//     const index1 = position - 1;
//     const index2 = position;
    
//     if (index2 >= n) {
//       return sorted[index1];
//     }
    
//     return (sorted[index1] + sorted[index2]) / 2;
//   }
// };
const calcP95 = (values: number[]) => {
  if (!values.length) return 0;

  const max = Math.max(...values);

  let filtered = values;

  // Apply filtering ONLY if max >= 1 Gbps
  if (max >= 1_000_000_000) {
    const threshold = max * 0.00001; // ignore extremely small samples
    filtered = values.filter(v => v >= threshold);
  }

  if (!filtered.length) return 0;

  const sorted = [...filtered].sort((a, b) => a - b);
  const n = sorted.length;

  const position = n * 0.95;

  if (position % 1 !== 0) {
    const index = Math.ceil(position) - 1;
    return sorted[Math.min(index, n - 1)];
  } else {
    const index1 = position - 1;
    const index2 = position;
    if (index2 >= n) return sorted[index1];
    return (sorted[index1] + sorted[index2]) / 2;
  }
};


// Get alternate switch name (TIG ↔ RAH fallback)
const getAlternateSwitchName = (switchName: string): string | null => {
  if (!switchName) return null;
  
  // If switch contains TIG, try RAH
  if (switchName.includes("TIG")) {
    return switchName.replace("TIG", "RAH");
  }
  // If switch contains RAH, try TIG
  if (switchName.includes("RAH")) {
    return switchName.replace("RAH", "TIG");
  }
  
  return null;
};

const IptPercentileReport = () => {
  const [selectedMonth, setSelectedMonth] = useState("");
  const [customers, setCustomers] = useState<CustomerReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "p95">("name");
  const [queryDateRange, setQueryDateRange] = useState<{ start: string; end: string; timeFrom: number; timeTill: number } | null>(null);
  const [loadedFromDb, setLoadedFromDb] = useState(false);
  const [dbRecordCount, setDbRecordCount] = useState(0);
  
  // Graph modal state
  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [graphCustomer, setGraphCustomer] = useState<CustomerReport | null>(null);
  const [graphData, setGraphData] = useState<any>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  // Generate available months (last 12 months)
  const availableMonths = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      months.push({ value, label });
    }
    return months;
  }, []);

  // Fetch all IPT customers
  const fetchAllCustomers = async () => {
    setLoading(true);
    try {
      // Fetch all customers (large page size to get all)
      const res = await axios.get(
        `${PRODUCTION_URL}/iptcustomers?page=1&pageSize=10000&status=all`
      );
      
      const customerList: CustomerReport[] = (res.data.customers || []).map((c: any) => ({
        id: c.id,
        customerName: c.customerName || "N/A",
        nbr: c.nbr || "N/A",
        port: c.port || "N/A",
        switchName: c.iptcustomer?.switchName || "N/A",
        interface: c.interface || "",
        capacity: c.downmbps || 0,
        p95Sent: null,
        p95Recv: null,
        p95Billing: null,
        unit: "Mbps",
        status: "pending",
      }));
      
      setCustomers(customerList);
    } catch (err) {
      console.error("Error fetching customers:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllCustomers();
  }, []);

  // Check and load from database when month changes
  const loadFromDatabase = async () => {
    if (!selectedMonth) return;
    
    setLoading(true);
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/percentile-reports?month=${selectedMonth}&reportType=IPT`
      );
      
      const dbReports = res.data.reports || [];
      
      if (dbReports.length > 0) {
        // Map database records to customer format
        const loadedCustomers: CustomerReport[] = dbReports.map((r: any) => ({
          id: r.customerId,
          customerName: r.customerName || "N/A",
          nbr: r.nbr || "N/A",
          port: r.port || "N/A",
          switchName: r.switchName || "N/A",
          interface: r.interface || "",
          capacity: r.capacity || 0,
          p95Sent: r.p95Sent ? r.p95Sent / (r.displayUnit === "Gbps" ? 1e9 : r.displayUnit === "Mbps" ? 1e6 : r.displayUnit === "Kbps" ? 1e3 : 1) : null,
          p95Recv: r.p95Recv ? r.p95Recv / (r.displayUnit === "Gbps" ? 1e9 : r.displayUnit === "Mbps" ? 1e6 : r.displayUnit === "Kbps" ? 1e3 : 1) : null,
          p95Billing: r.p95Combined ? r.p95Combined / (r.displayUnit === "Gbps" ? 1e9 : r.displayUnit === "Mbps" ? 1e6 : r.displayUnit === "Kbps" ? 1e3 : 1) : null,
          unit: r.displayUnit || "Mbps",
          status: r.status === "success" ? "success" : "error",
          error: r.errorMessage,
          dataSource: r.dataSource,
          samples: r.samples,
          usedSwitch: r.usedSwitch,
        }));
        
        setCustomers(loadedCustomers);
        setLoadedFromDb(true);
        setDbRecordCount(dbReports.length);
        console.log(`Loaded ${dbReports.length} IPT reports from database`);
      } else {
        // No data in database, reset to pending state
        await fetchAllCustomers();
        setLoadedFromDb(false);
        setDbRecordCount(0);
      }
    } catch (err) {
      console.error("Error loading from database:", err);
      setLoadedFromDb(false);
    } finally {
      setLoading(false);
    }
  };

  // Load from database when month changes
  useEffect(() => {
    if (selectedMonth) {
      loadFromDatabase();
    }
  }, [selectedMonth]);

  // Generate 95th percentile report for all customers (force regenerate)
  const generateReport = async (forceRegenerate = false) => {
    if (!selectedMonth) return;
    
    // If already loaded and not forcing regenerate, skip
    if (loadedFromDb && !forceRegenerate) {
      return;
    }
    
    let customerList = customers;
    
    // Fetch fresh customer list if regenerating or no customers
    if (forceRegenerate || customers.length === 0) {
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/iptcustomers?page=1&pageSize=10000&status=all`
        );

        
        customerList = (res.data.customers || []).map((c: any) => ({
          id: c.id,
          customerName: c.customerName || "N/A",
          nbr: c.nbr || "N/A",
          port: c.port || "N/A",
          switchName: c.iptcustomer?.switchName || "N/A",
          interface: c.interface || "",
          capacity: c.downmbps || 0,
          p95Sent: null,
          p95Recv: null,
          p95Billing: null,
          unit: "Mbps",
          status: "pending" as const,
        }));
        
        setCustomers(customerList);
        setLoadedFromDb(false);
      } catch (err) {
        console.error("Error fetching customers:", err);
        return;
      } finally {
        setLoading(false);
      }
    }
    
    if (customerList.length === 0) return;

    setGenerating(true);
    setProgress(0);
    setProcessedCount(0);

    const auth = localStorage.getItem("zabbixAuth");
    const [year, month] = selectedMonth.split("-").map(Number);
    
    // Calculate start of month (e.g., October 1, 2024 00:00:00)
    const startDate = new Date(year, month - 1, 1, 0, 0, 0);
    // Calculate end of month (e.g., October 31, 2024 23:59:59)
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    const time_from = Math.floor(startDate.getTime() / 1000);
    const time_till = Math.floor(endDate.getTime() / 1000);

    // Store the date range for display
    setQueryDateRange({
      start: startDate.toLocaleString("en-GB", { 
        day: "2-digit", month: "short", year: "numeric", 
        hour: "2-digit", minute: "2-digit", second: "2-digit" 
      }),
      end: endDate.toLocaleString("en-GB", { 
        day: "2-digit", month: "short", year: "numeric", 
        hour: "2-digit", minute: "2-digit", second: "2-digit" 
      }),
      timeFrom: time_from,
      timeTill: time_till,
    });

    // console.log(`Querying Zabbix: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    // console.log(`Unix timestamps: time_from=${time_from}, time_till=${time_till}`);

    // Process customers in batches to avoid overwhelming the API
    const batchSize = 5;
    const updatedCustomers = [...customerList];

    for (let i = 0; i < customerList.length; i += batchSize) {
      const batch = customerList.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (customer, batchIndex) => {
          const index = i + batchIndex;
          
          // Helper function to fetch data for a given switch
          const fetchDataForSwitch = async (switchName: string, port: string, nbr: boolean = false): Promise<{
            sentValues: number[];
            recvValues: number[];
            dataSource: string;
            usedSwitch: string;
          } | null> => {
            try {
              const zabbixHostName = getZabbixHostName(switchName);
              
              const host = await zabbixApi({
                method: "host.get",
                params: {
                  output: ["hostid"],
                  filter: { host: [zabbixHostName] },
                },
                id: 1,
                auth,
              });


              if (!host || !host[0]?.hostid) {
                return null;
              }
              const graph = await zabbixApi({
                method: "graph.get",
                params: {
                  hostids: [host[0].hostid],
                  search: { name: nbr ? port : customer.interface },
                  output: "extend",
                  selectItems: "extend",
                },
                id: 1,
                auth,
              });


              if (!graph || !graph.length) {
                return null;
              }

              const itemids = graph[0].items.map((item: any) => item.itemid);

              if (itemids.length < 2) {
                return null;
              }

              // First try to get detailed history data
              let history = await zabbixApi({
                method: "history.get",
                params: {
                  history: 3,
                  itemids,
                  time_from,
                  time_till,
                  output: "extend",
                  sortfield: "clock",
                  sortorder: "ASC",
                },
                id: 1,
                auth,
              });

              let sentValues: number[] = [];
              let recvValues: number[] = [];
              let dataSource = "history";

              if (history && history.length > 0) {
                const sentData = history.filter((d: any) => d.itemid === itemids[0]);
                const recvData = history.filter((d: any) => d.itemid === itemids[1]);
                sentValues = sentData.map((d: any) => Number(d.value));
                recvValues = recvData.map((d: any) => Number(d.value));
              } else {
                // Fall back to trends data
                const trends = await zabbixApi({
                  method: "trend.get",
                  params: {
                    itemids,
                    time_from,
                    time_till,
                    output: "extend",
                  },
                  id: 1,
                  auth,
                });

                if (!trends || trends.length === 0) {
                  return null;
                }

                const sentTrends = trends.filter((d: any) => d.itemid === itemids[0]);
                const recvTrends = trends.filter((d: any) => d.itemid === itemids[1]);
                // Use value_avg for 95th percentile (closer to Zabbix calculation)
                sentValues = sentTrends.map((d: any) => Number(d.value_avg));
                recvValues = recvTrends.map((d: any) => Number(d.value_avg));
                dataSource = "trends";
              }

              if (sentValues.length === 0 && recvValues.length === 0) {
                return null;
              }

              return { sentValues, recvValues, dataSource, usedSwitch: switchName };
            } catch {
              return null;
            }
          };

          try {
            // Update status to loading
            updatedCustomers[index] = { ...updatedCustomers[index], status: "loading" };
            setCustomers([...updatedCustomers]);

            if (!customer.switchName || customer.switchName === "N/A") {
              throw new Error("No switch name");
            }

            if (!customer.interface) {
              throw new Error("No interface defined");
            }

            // Check if this is a TIG/RAH customer that needs combined data
            const alternateSwitch = getAlternateSwitchName(customer.switchName);
            const isTigRahCustomer = alternateSwitch !== null && 
              (customer.switchName.includes("TIG") || customer.switchName.includes("RAH"));

            let sentValues: number[] = [];
            let recvValues: number[] = [];
            let dataSource = "history";
            let usedSwitch = customer.switchName;
            let usedFallback = false;
            let fallbackSource = "";

            if (isTigRahCustomer) {
              // For TIG/RAH customers, fetch from BOTH switches and combine
              // console.log(`TIG/RAH customer: Fetching from both ${customer.switchName} and ${alternateSwitch}...`);
              
              const result1 = await fetchDataForSwitch(customer.switchName, customer.port);
              const result2 = await fetchDataForSwitch(alternateSwitch!, customer.port);
              
              if (result1) {
                sentValues.push(...result1.sentValues);
                recvValues.push(...result1.recvValues);
                dataSource = result1.dataSource;
                // console.log(`✓ Got ${result1.sentValues.length} samples from ${customer.switchName}`);
              }
              
              if (result2) {
                sentValues.push(...result2.sentValues);
                recvValues.push(...result2.recvValues);
                if (result2.dataSource === "trends") dataSource = "trends";
                // console.log(`✓ Got ${result2.sentValues.length} samples from ${alternateSwitch}`);
              }
              
              if (result1 && result2) {
                usedSwitch = `${customer.switchName}+${alternateSwitch}`;
                usedFallback = true;
                fallbackSource = "Combined";
              } else if (result1) {
                usedSwitch = customer.switchName;
              } else if (result2) {
                usedSwitch = alternateSwitch!;
                usedFallback = true;
                fallbackSource = "TIG↔RAH";
              }
              
              // If still no data from either, try NBR
              if (sentValues.length === 0 && recvValues.length === 0) {
                if (customer.nbr && customer.nbr !== "N/A") {
                  // console.log(customer.port);
                  let nbr = true;

                  // console.log(`No data on TIG/RAH switches, trying NBR: ${customer.nbr}...`);
                  const nbrResult = await fetchDataForSwitch(customer.nbr, customer.port, nbr);
                  if (nbrResult) {
                    sentValues = nbrResult.sentValues;
                    recvValues = nbrResult.recvValues;
                    dataSource = nbrResult.dataSource;
                    usedSwitch = customer.nbr;
                    usedFallback = true;
                    fallbackSource = "NBR";
                    // console.log(`✓ Found data using NBR: ${customer.nbr}`);
                  }
                }
              }
            } else {
              // Non TIG/RAH customer - use original fallback logic
              let result = await fetchDataForSwitch(customer.switchName, customer.port);

              // If no data, try alternate switch
              if (!result && alternateSwitch) {
                console.log(`No data on ${customer.switchName}, trying ${alternateSwitch}...`);
                result = await fetchDataForSwitch(alternateSwitch, customer.port);
                if (result) {
                  usedFallback = true;
                  fallbackSource = "TIG↔RAH";
                  console.log(`✓ Found data on ${alternateSwitch}`);
                }
              }

              // If still no data, try NBR
              if (!result && customer.nbr && customer.nbr !== "N/A") {
                let nbr = true;
                console.log(`No data on switches, trying NBR: ${customer.nbr}...`);
                result = await fetchDataForSwitch(customer.nbr, customer.port, nbr);
                if (result) {
                  usedFallback = true;
                  fallbackSource = "NBR";
                  console.log(`✓ Found data using NBR: ${customer.nbr}`);
                }
              }

              if (result) {
                sentValues = result.sentValues;
                recvValues = result.recvValues;
                dataSource = result.dataSource;
                usedSwitch = result.usedSwitch;
              }
            }

            if (sentValues.length === 0 && recvValues.length === 0) {
              const tried = [customer.switchName];
              if (alternateSwitch) tried.push(alternateSwitch);
              if (customer.nbr && customer.nbr !== "N/A") tried.push(`NBR:${customer.nbr}`);
              throw new Error(`No data on: ${tried.join(", ")}`);
            }

            const combinedValues = [...sentValues, ...recvValues];
            const p95Combined = calcP95(combinedValues);

            const p95Sent = calcP95(sentValues);
            const p95Recv = calcP95(recvValues);
            
            // Billing is MAX of sent or recv 95th percentile (industry standard)
            // This matches how Zabbix and most ISPs calculate 95th percentile billing
            // const p95Combined = Math.max(p95Sent, p95Recv);
            
            // Use MAX(p95Sent, p95Recv) as billing value
            const p95Billing = p95Combined;

            // Determine unit
            let displayUnit = "bps";
            let divisor = 1;
            if (p95Billing > 1_000_000_000) {
              displayUnit = "Gbps";
              divisor = 1_000_000_000;
            } else if (p95Billing > 1_000_000) {
              displayUnit = "Mbps";
              divisor = 1_000_000;
            } else if (p95Billing > 1_000) {
              displayUnit = "Kbps";
              divisor = 1_000;
            }

            updatedCustomers[index] = {
              ...updatedCustomers[index],
              p95Sent: p95Sent / divisor,
              p95Recv: p95Recv / divisor,
              p95Billing: p95Billing / divisor,
              unit: displayUnit,
              status: "success",
              dataSource: dataSource as "history" | "trends",
              samples: Math.max(sentValues.length, recvValues.length),
              usedSwitch: usedFallback ? `${usedSwitch} (${fallbackSource})` : undefined,
            };
          } catch (err: any) {
            updatedCustomers[index] = {
              ...updatedCustomers[index],
              status: "error",
              error: err.message || "Failed to fetch data",
            };
          }
        })
      );

      setCustomers([...updatedCustomers]);
      setProcessedCount(Math.min(i + batchSize, customerList.length));
      setProgress(Math.round(((i + batchSize) / customerList.length) * 100));
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < customerList.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Save results to database
    try {
      const reportsToSave = updatedCustomers
        .filter((c) => c.status === "success" || c.status === "error")
        .map((c) => ({
          reportType: "IPT",
          month: selectedMonth,
          customerId: c.id,
          customerName: c.customerName,
          nbr: c.nbr,
          port: c.port,
          switchName: c.switchName,
          interface: c.interface,
          capacity: c.capacity,
          p95Sent: c.p95Sent ? c.p95Sent * (c.unit === "Gbps" ? 1e9 : c.unit === "Mbps" ? 1e6 : c.unit === "Kbps" ? 1e3 : 1) : null,
          p95Recv: c.p95Recv ? c.p95Recv * (c.unit === "Gbps" ? 1e9 : c.unit === "Mbps" ? 1e6 : c.unit === "Kbps" ? 1e3 : 1) : null,
          p95Combined: c.p95Billing ? c.p95Billing * (c.unit === "Gbps" ? 1e9 : c.unit === "Mbps" ? 1e6 : c.unit === "Kbps" ? 1e3 : 1) : null,
          displayUnit: c.unit,
          dataSource: c.dataSource,
          samples: c.samples,
          usedSwitch: c.usedSwitch,
          status: c.status,
          errorMessage: c.error,
        }));

      const saveRes = await axios.post(`${PRODUCTION_URL}/percentile-reports/bulk`, { reports: reportsToSave });
      // console.log(`Database: ${saveRes.data.created} created, ${saveRes.data.updated} updated (total: ${saveRes.data.total})`);
    } catch (err) {
      console.error("Error saving reports to database:", err);
    }

    setGenerating(false);
  };

  // Filter and sort customers
  const filteredCustomers = useMemo(() => {
    let result = customers.filter(
      (c) =>
        c.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.nbr.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.switchName.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (sortBy === "p95") {
      result = result.sort((a, b) => (b.p95Billing || 0) - (a.p95Billing || 0));
    } else {
      result = result.sort((a, b) => a.customerName.localeCompare(b.customerName));
    }

    return result;
  }, [customers, searchQuery, sortBy]);

  // Calculate summary stats
  const summary = useMemo(() => {
    const successful = customers.filter((c) => c.status === "success");
    const totalP95 = successful.reduce((sum, c) => sum + (c.p95Billing || 0), 0);
    return {
      total: customers.length,
      successful: successful.length,
      failed: customers.filter((c) => c.status === "error").length,
      pending: customers.filter((c) => c.status === "pending").length,
      avgP95: successful.length > 0 ? totalP95 / successful.length : 0,
    };
  }, [customers]);

  // Export to CSV
  const exportCSV = () => {
    const monthLabel = availableMonths.find((m) => m.value === selectedMonth)?.label || selectedMonth;
    const headers = ["Customer Name", "NBR", "Switch Name", "Interface", "Capacity (Mbps)", "95th Sent", "95th Recv", "95th Billing", "Unit", "Status"];
    const rows = filteredCustomers.map((c) => [
      c.customerName,
      c.nbr,
      c.port,
      c.switchName,
      c.interface,
      c.capacity,
      c.p95Sent?.toFixed(2) || "N/A",
      c.p95Recv?.toFixed(2) || "N/A",
      c.p95Billing?.toFixed(2) || "N/A",
      c.unit,
      c.status,
    ]);

    const csvContent = [
      `IPT 95th Percentile Report - ${monthLabel}`,
      "",
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ipt-95th-percentile-${selectedMonth}.csv`;
    a.click();
  };

  // Fetch graph data for a customer
  const fetchGraphData = async (customer: CustomerReport) => {
    if (!selectedMonth || !customer.interface) return;
    
    setGraphCustomer(customer);
    setGraphModalOpen(true);
    setGraphLoading(true);
    setGraphData(null);
    
    try {
      // Get Zabbix auth
      const authRes = await zabbixApi({
        method: "user.login",
        params: { user: "api", password: "zabbix" },
        id: 1,
      });
      const auth = authRes;
      
      // Parse date range
      const [year, month] = selectedMonth.split("-").map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      const time_from = Math.floor(startDate.getTime() / 1000);
      const time_till = Math.floor(endDate.getTime() / 1000);
      
      // Get switch name (use primary or try both TIG/RAH)
      const switchName = customer.switchName;
      const alternateSwitch = getAlternateSwitchName(switchName);
      const isTigRahCustomer = alternateSwitch && (switchName.includes("TIG") || switchName.includes("RAH"));
      
      const fetchForSwitch = async (sw: string) => {
        const zabbixHost = getZabbixHostName(sw);
        
        // Get host ID
        const hostRes = await zabbixApi({
          method: "host.get",
          params: { filter: { host: zabbixHost }, output: ["hostid"] },
          id: 1, auth,
        });
        if (!hostRes?.length) return null;
        const hostid = hostRes[0].hostid;
        
        // Get items for interface
        const itemsRes = await zabbixApi({
          method: "item.get",
          params: {
            hostids: [hostid],
            search: { key_: customer.interface },
            output: ["itemid", "name", "key_"],
          },
          id: 1, auth,
        });
        
        const sentItem = itemsRes?.find((i: any) => i.key_.includes("Bits sent") || i.name.includes("Bits sent"));
        const recvItem = itemsRes?.find((i: any) => i.key_.includes("Bits received") || i.name.includes("Bits received"));
        
        if (!sentItem || !recvItem) return null;
        
        // Get history data
        const historyRes = await zabbixApi({
          method: "history.get",
          params: {
            history: 3,
            itemids: [sentItem.itemid, recvItem.itemid],
            time_from,
            time_till,
            output: "extend",
            sortfield: "clock",
            sortorder: "ASC",
          },
          id: 1, auth,
        });
        
        if (historyRes?.length > 0) {
          const sentData = historyRes.filter((d: any) => d.itemid === sentItem.itemid);
          const recvData = historyRes.filter((d: any) => d.itemid === recvItem.itemid);
          return { sentData, recvData, source: "history" };
        }
        
        // Fallback to trends
        const trendsRes = await zabbixApi({
          method: "trend.get",
          params: {
            itemids: [sentItem.itemid, recvItem.itemid],
            time_from,
            time_till,
            output: "extend",
          },
          id: 1, auth,
        });
        
        if (trendsRes?.length > 0) {
          const sentTrends = trendsRes.filter((d: any) => d.itemid === sentItem.itemid);
          const recvTrends = trendsRes.filter((d: any) => d.itemid === recvItem.itemid);
          return { sentData: sentTrends, recvData: recvTrends, source: "trends" };
        }
        
        return null;
      };
      
      let allSentData: any[] = [];
      let allRecvData: any[] = [];
      let dataSource = "history";
      
      if (isTigRahCustomer) {
        // Fetch from both switches
        const result1 = await fetchForSwitch(switchName);
        const result2 = await fetchForSwitch(alternateSwitch!);
        
        if (result1) {
          allSentData.push(...result1.sentData);
          allRecvData.push(...result1.recvData);
          dataSource = result1.source;
        }
        if (result2) {
          allSentData.push(...result2.sentData);
          allRecvData.push(...result2.recvData);
          if (result2.source === "trends") dataSource = "trends";
        }
      } else {
        const result = await fetchForSwitch(switchName);
        if (result) {
          allSentData = result.sentData;
          allRecvData = result.recvData;
          dataSource = result.source;
        }
      }
      
      if (allSentData.length === 0 && allRecvData.length === 0) {
        throw new Error("No data available");
      }
      
      // Process data for chart
      const isHistory = dataSource === "history";
      const sentPoints = allSentData.map((d: any) => ({
        timestamp: Number(d.clock) * 1000,
        value: isHistory ? Number(d.value) : Number(d.value_avg),
      })).sort((a: any, b: any) => a.timestamp - b.timestamp);
      
      const recvPoints = allRecvData.map((d: any) => ({
        timestamp: Number(d.clock) * 1000,
        value: isHistory ? Number(d.value) : Number(d.value_avg),
      })).sort((a: any, b: any) => a.timestamp - b.timestamp);
      
      // Determine scale
      const allValues = [...sentPoints.map((p: any) => p.value), ...recvPoints.map((p: any) => p.value)];
      const maxValue = Math.max(...allValues);
      let unit = "bps";
      let divisor = 1;
      if (maxValue > 1_000_000_000) { unit = "Gbps"; divisor = 1_000_000_000; }
      else if (maxValue > 1_000_000) { unit = "Mbps"; divisor = 1_000_000; }
      else if (maxValue > 1_000) { unit = "Kbps"; divisor = 1_000; }
      
      // Sample data for chart (limit to ~500 points for performance)
      const sampleRate = Math.max(1, Math.floor(sentPoints.length / 500));
      const sampledSent = sentPoints.filter((_: any, i: number) => i % sampleRate === 0);
      const sampledRecv = recvPoints.filter((_: any, i: number) => i % sampleRate === 0);
      
      // Create chart data
      const labels = sampledSent.map((p: any) => 
        new Date(p.timestamp).toLocaleDateString("en-US", { day: "2-digit", month: "short" })
      );
      
      setGraphData({
        labels,
        datasets: [
          {
            label: `Sent (${unit})`,
            data: sampledSent.map((p: any) => p.value / divisor),
            borderColor: "rgb(34, 211, 238)",
            backgroundColor: "rgba(34, 211, 238, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
          {
            label: `Received (${unit})`,
            data: sampledRecv.map((p: any) => p.value / divisor),
            borderColor: "rgb(236, 72, 153)",
            backgroundColor: "rgba(236, 72, 153, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
        unit,
        dataSource,
        p95Sent: customer.p95Sent,
        p95Recv: customer.p95Recv,
        p95Billing: customer.p95Billing,
        customerUnit: customer.unit,
      });
    } catch (err: any) {
      console.error("Error fetching graph data:", err);
      setGraphData({ error: err.message || "Failed to fetch graph data" });
    } finally {
      setGraphLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center">
            <FileSpreadsheet className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">IPT 95th Percentile Report</h1>
            <p className="text-muted-foreground">
              Monthly bandwidth usage report for all IPT customers
            </p>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Generate Report</CardTitle>
          <CardDescription>
            Select a month to calculate the 95th percentile bandwidth usage for all IPT customers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Month</label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {availableMonths.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loadedFromDb ? (
              <Button
                onClick={() => generateReport(true)}
                disabled={generating || loading}
                variant="outline"
                className="border-orange-500 text-orange-500 hover:bg-orange-500/10"
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerate Report
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={() => generateReport(false)}
                disabled={!selectedMonth || generating || loading}
                className="bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700"
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Report"
                )}
              </Button>
            )}

            {summary.successful > 0 && (
              <Button variant="outline" onClick={exportCSV}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            )}
          </div>

          {/* Loaded from Database Message */}
          {loadedFromDb && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 text-green-400">
                <Database className="h-4 w-4" />
                <span className="font-medium">Loaded from Database</span>
                <Badge className="bg-green-500/20 text-green-400">{dbRecordCount} records</Badge>
              </div>
              <p className="text-muted-foreground mt-1">
                Report data was loaded from the database. Click "Regenerate Report" to fetch fresh data from Zabbix.
              </p>
            </div>
          )}

          {/* Date Range Display */}
          {queryDateRange && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm">
              <div className="font-medium text-blue-400 mb-1">📅 Querying Date Range:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  <span className="text-gray-400">From:</span>{" "}
                  <span className="text-white font-mono">{queryDateRange.start}</span>
                </div>
                <div>
                  <span className="text-gray-400">To:</span>{" "}
                  <span className="text-white font-mono">{queryDateRange.end}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Unix: {queryDateRange.timeFrom} → {queryDateRange.timeTill}
              </div>
            </div>
          )}

          {/* Progress bar */}
          {generating && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Processing customers...</span>
                <span>
                  {processedCount} / {customers.length}
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{summary.total}</div>
            <div className="text-sm text-muted-foreground">Total Customers</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-500">{summary.successful}</div>
            <div className="text-sm text-muted-foreground">Successful</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-500">{summary.failed}</div>
            <div className="text-sm text-muted-foreground">Failed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-500">{summary.pending}</div>
            <div className="text-sm text-muted-foreground">Pending</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-500">
              {summary.avgP95.toFixed(2)}
            </div>
            <div className="text-sm text-muted-foreground">Avg 95th %ile</div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="text-lg">
              {selectedMonth
                ? `Report: ${availableMonths.find((m) => m.value === selectedMonth)?.label}`
                : "Customer List"}
            </CardTitle>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[250px]"
                />
              </div>
              <Select value={sortBy} onValueChange={(v: "name" | "p95") => setSortBy(v)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort by Name</SelectItem>
                  <SelectItem value="p95">Sort by 95th %ile</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2">Loading customers...</span>
            </div>
          ) : (
            <div className="rounded-md border max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>Customer Name</TableHead>
                    <TableHead>NBR</TableHead>
                    <TableHead>PORT</TableHead>
                    <TableHead>Switch Name</TableHead>
                    <TableHead>Interface</TableHead>
                    <TableHead className="text-right">Capacity</TableHead>
                    <TableHead className="text-right">95th Sent</TableHead>
                    <TableHead className="text-right">95th Recv</TableHead>
                    <TableHead className="text-right">95th Billing</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-center">Graph</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.map((customer, index) => (
                    <TableRow key={customer.id}>
                      <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="font-medium">{customer.customerName}</TableCell>
                      <TableCell>{customer.nbr}</TableCell>
                      <TableCell>{customer.port}</TableCell>
                      <TableCell>{customer.switchName}</TableCell>
                      <TableCell className="font-mono text-xs">{customer.interface}</TableCell>
                      <TableCell className="text-right">{customer.capacity} Mbps</TableCell>
                      <TableCell className="text-right text-cyan-500">
                        {customer.p95Sent !== null ? `${customer.p95Sent.toFixed(2)} ${customer.unit}` : "-"}
                      </TableCell>
                      <TableCell className="text-right text-pink-500">
                        {customer.p95Recv !== null ? `${customer.p95Recv.toFixed(2)} ${customer.unit}` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-bold text-yellow-500">
                        {customer.p95Billing !== null ? `${customer.p95Billing.toFixed(2)} ${customer.unit}` : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {customer.status === "pending" && (
                          <Badge variant="secondary" className="gap-1">
                            <Clock className="h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                        {customer.status === "loading" && (
                          <Badge variant="secondary" className="gap-1 bg-blue-500/20 text-blue-400">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading
                          </Badge>
                        )}
                        {customer.status === "success" && (
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant="secondary" className="gap-1 bg-green-500/20 text-green-400">
                              <CheckCircle2 className="h-3 w-3" />
                              Done
                            </Badge>
                            <span className={`text-[10px] ${customer.dataSource === "trends" ? "text-yellow-400" : "text-gray-400"}`}>
                              {customer.dataSource === "trends" ? "📊 Trends" : "📈 History"} ({customer.samples?.toLocaleString()})
                            </span>
                            {customer.usedSwitch && (
                              <span className="text-[10px] text-orange-400" title={`Data fetched from ${customer.usedSwitch} (fallback)`}>
                                🔄 {customer.usedSwitch}
                              </span>
                            )}
                          </div>
                        )}
                        {customer.status === "error" && (
                          <div className="flex flex-col items-center gap-1">
                            <Badge
                              variant="secondary"
                              className="gap-1 bg-red-500/20 text-red-400"
                            >
                              <AlertCircle className="h-3 w-3" />
                              Error
                            </Badge>
                            <span className="text-[10px] text-red-400 max-w-[120px] truncate" title={customer.error}>
                              {customer.error}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fetchGraphData(customer)}
                          disabled={customer.status !== "success"}
                          className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                          title="View monthly traffic graph"
                        >
                          <LineChart className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          
          {!loading && filteredCustomers.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No customers found
            </div>
          )}
        </CardContent>
      </Card>

      {/* Graph Modal */}
      <Dialog open={graphModalOpen} onOpenChange={setGraphModalOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LineChart className="h-5 w-5 text-blue-400" />
              Monthly Traffic Graph
            </DialogTitle>
          </DialogHeader>
          
          {graphCustomer && (
            <div className="space-y-4">
              {/* Customer Info */}
              <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                <div className="font-medium text-lg">{graphCustomer.customerName}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Interface:</span>
                    <span className="ml-2 font-mono">{graphCustomer.interface}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Switch:</span>
                    <span className="ml-2">{graphCustomer.switchName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Month:</span>
                    <span className="ml-2">{availableMonths.find(m => m.value === selectedMonth)?.label}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Capacity:</span>
                    <span className="ml-2">{graphCustomer.capacity} Mbps</span>
                  </div>
                </div>
              </div>
              
              {/* 95th Percentile Stats */}
              {graphData && !graphData.error && (
                <div className="grid grid-cols-3 gap-4">
                  <Card className="bg-cyan-500/10 border-cyan-500/30">
                    <CardContent className="pt-4 text-center">
                      <div className="text-sm text-cyan-400">95th Sent</div>
                      <div className="text-2xl font-bold text-cyan-400">
                        {graphData.p95Sent?.toFixed(2)} {graphData.customerUnit}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-pink-500/10 border-pink-500/30">
                    <CardContent className="pt-4 text-center">
                      <div className="text-sm text-pink-400">95th Received</div>
                      <div className="text-2xl font-bold text-pink-400">
                        {graphData.p95Recv?.toFixed(2)} {graphData.customerUnit}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-yellow-500/10 border-yellow-500/30">
                    <CardContent className="pt-4 text-center">
                      <div className="text-sm text-yellow-400">95th Billing (MAX)</div>
                      <div className="text-2xl font-bold text-yellow-400">
                        {graphData.p95Billing?.toFixed(2)} {graphData.customerUnit}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {/* Graph */}
              <div className="h-[400px] bg-background rounded-lg p-4 border">
                {graphLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <span className="ml-2">Loading graph data...</span>
                  </div>
                ) : graphData?.error ? (
                  <div className="flex flex-col items-center justify-center h-full text-red-400">
                    <AlertCircle className="h-8 w-8 mb-2" />
                    <span>{graphData.error}</span>
                  </div>
                ) : graphData ? (
                  <Line
                    data={{
                      labels: graphData.labels,
                      datasets: graphData.datasets,
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      interaction: {
                        mode: "index",
                        intersect: false,
                      },
                      plugins: {
                        legend: {
                          position: "top",
                        },
                        title: {
                          display: true,
                          text: `Traffic for ${availableMonths.find(m => m.value === selectedMonth)?.label}`,
                        },
                        tooltip: {
                          callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`,
                          },
                        },
                      },
                      scales: {
                        x: {
                          title: {
                            display: true,
                            text: "Date",
                          },
                          ticks: {
                            maxTicksLimit: 15,
                          },
                        },
                        y: {
                          title: {
                            display: true,
                            text: graphData.unit,
                          },
                          beginAtZero: true,
                        },
                      },
                    }}
                  />
                ) : null}
              </div>
              
              {/* Data Source Info */}
              {graphData && !graphData.error && (
                <div className="text-xs text-muted-foreground text-center">
                  Data source: {graphData.dataSource === "trends" ? "📊 Trends (hourly)" : "📈 History (per-minute)"}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IptPercentileReport;

