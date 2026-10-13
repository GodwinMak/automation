import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_SERVICE_TYPES, ServiceType } from "./types";

const LABELS: Record<ServiceType, string> = {
  DIA: "DIA Customers",
  IPT: "IPT Customers",
  SHARED: "Shared Customers",
  L3VPN: "L3VPN Customers",
  L2VPN: "L2VPN Circuits",
  FTTH: "FTTH Customers",
};

type Props = {
  serviceType: ServiceType;
  onChange: (type: ServiceType) => void;
};

const ServiceTypeFilterPanel = ({ serviceType, onChange }: Props) => {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">Service Type</label>
      <Select value={serviceType} onValueChange={(v) => onChange(v as ServiceType)}>
        <SelectTrigger className="w-full sm:w-64">
          <SelectValue placeholder="Select type" />
        </SelectTrigger>
        <SelectContent>
          {ALL_SERVICE_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default ServiceTypeFilterPanel;
