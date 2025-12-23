import { Badge } from "@/components/ui/badge";

interface CustomerData {
  customerName: string;
  interface: string;
  nbr: string;
  port: string;
  cid: string;
  downmbps: number;
  upmbps: number;
  upgradeType: string;
  status: "active" | "inactive" | "pending";
  switchName: string;
  upgrade_type: string;
  diacustomer?: any;
  client_db?: any;
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
  const adminStatus = data?.diacustomer?.adminStatus || data?.adminStatus || "N/A";
  const description = data?.diacustomer?.description || data?.description || "N/A";

  // Network information items
  const networkInfoItems = [
    { label: "Customer Name", value: data?.customerName || "N/A" },
    { label: "Interface Name", value: data?.interface || "N/A" },
    { label: "Neighbor Switch", value: data?.nbr || "N/A" },
    { label: "Neighbor Port", value: data?.port || "N/A" },
    { label: "Circuit ID", value: data?.cid || "N/A" },
    { label: "Upload (Mbps)", value: data?.upmbps || "N/A" },
    { label: "Download (Mbps)", value: data?.downmbps || "N/A" },
    { label: "Upgrade Type", value: data?.upgrade_type || "N/A" },
    { label: "Switch Name (PE/BNG)", value: switchName },
    { label: "Block Address", value: destination },
    { label: "Admin Status", value: adminStatus },
    { label: "Description", value: description },
  ];

  // Client/Billing information items
  const clientDbItems = data?.client_db ? [
    { label: "Pastel Name", value: data.client_db.customer_name_pastel },
    { label: "Email Address", value: data.client_db.email_address },
    { label: "Phone Number", value: data.client_db.phone_number },
    { label: "Area", value: data.client_db.area },
    { label: "Network Type", value: data.client_db.onnet_offnet?.toUpperCase() },
    { label: "Provider", value: data.client_db.provider },
    { label: "Contact Name", value: data.client_db.first_name },
    { label: "Medium Details", value: data.client_db.medium_details },
    { label: "Comments", value: data.client_db.special_comments },
  ] : [];

  return (
    <div className="space-y-8">
      {/* Network Information */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">Network Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {networkInfoItems.map((item, index) => (
            <div
              key={index}
              className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
            >
              <div className="text-sm text-muted-foreground mb-1">{item.label}</div>
              <div className="text-lg font-semibold text-foreground">{item.value}</div>
            </div>
          ))}
          {/* Status Badge */}
          <div className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors">
            <div className="text-sm text-muted-foreground mb-1">Operational Status</div>
            <Badge 
              variant={getStatusVariant(data?.status)} 
              className={`text-sm capitalize ${
                operationalStatus === "up" 
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" 
                  : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              }`}
            >
              {operationalStatus === "up" ? "UP" : "DOWN"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Client/Billing Information */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Client/Billing Information
          {!data?.client_db && (
            <span className="text-sm font-normal text-muted-foreground ml-2">
              (Not linked - Click "Edit Details" to add)
            </span>
          )}
        </h3>
        {clientDbItems.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clientDbItems.map((item, index) => (
              <div
                key={index}
                className="bg-card border border-green-500/30 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="text-sm text-green-400 mb-1">{item.label}</div>
                <div className="text-lg font-semibold text-foreground">
                  {item.value || "N/A"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-dashed border-border rounded-lg p-6 text-center">
            <p className="text-muted-foreground">
              No billing information linked to this customer.
              Click "Edit Details" to add contact and billing information.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
