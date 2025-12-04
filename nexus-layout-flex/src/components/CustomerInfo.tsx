import { Badge } from "@/components/ui/badge";

interface CustomerData {
  customerName: string;
  interface: string;
  nbr: string;
  port: string;
  cid: string;
  downmbps: number;
  upgradeType: string;
  status: "active" | "inactive" | "pending";
  switchName: string;
  upgrade_type: string;
}

interface CustomerInfoProps {
  data: CustomerData;
}

export const CustomerInfo = ({ data }: CustomerInfoProps) => {
  const getStatusVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "inactive":
        return "secondary";
      case "pending":
        return "outline";
      default:
        return "default";
    }
  };

  // Handle both nested (from DIA list) and flat (from Watchlist) data structures
  const switchName = data?.diacustomer?.switchName || data?.switchName || "N/A";
  const destination = data?.diacustomer?.destination || data?.destination || "N/A";
  const operationalStatus = data?.diacustomer?.operationalStatus || data?.status || "unknown";

  const infoItems = [
    { label: "Customer Name", value: data?.customerName || "N/A" },
    { label: "Interface Name", value: data?.interface || "N/A" },
    { label: "Neighbor Switch", value: data?.nbr || "N/A" },
    { label: "Neighbor Port", value: data?.port || "N/A" },
    { label: "Circuit ID", value: data?.cid || "N/A" },
    { label: "Capacity", value: data?.downmbps ? `${data.downmbps} Mbps` : "N/A" },
    { label: "Upgrade Type", value: data?.upgrade_type || "N/A" },
    { label: "Switch Name", value: switchName },
    { label: "Block Address", value: destination },
    { label: "Email Address", value: data?.client_db?.email_address || "N/A" },
    { label: "Phone Number", value: data?.client_db?.phone_number || "N/A" },
    { label: "Onnet or Offnet", value: data?.client_db?.onnet_offnet || "N/A" },
    { label: "Medium Details", value: data?.client_db?.medium_details || "N/A" },
    { label: "Customer Name in Pastel", value: data?.client_db?.customer_name_pastel || "N/A" },
    { label: "Area", value: data?.client_db?.area || "N/A" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {infoItems.map((item, index) => (
        <div
          key={index}
          className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
        >
          <div className="text-sm text-muted-foreground mb-1">{item.label}</div>
          <div className="text-lg font-semibold text-foreground">{item.value}</div>
        </div>
      ))}
      <div className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors">
        <div className="text-sm text-muted-foreground mb-1">Status</div>
        <Badge variant={getStatusVariant(data?.status)} className="text-sm capitalize">
          {operationalStatus === "up" ? "Active" : "Inactive"}
        </Badge>
      </div>
    </div>
  );
};
