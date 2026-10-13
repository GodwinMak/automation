import React from "react";
import { Router, ListFilter, History as HistoryIcon } from "lucide-react";
import type { SmsMode } from "./types";

const MODES: { value: SmsMode; label: string; description: string; icon: any }[] = [
  { value: "bySwitch", label: "By Switch", description: "Customers on a chosen network switch", icon: Router },
  { value: "byServiceType", label: "By Service Type", description: "All customers of one service (DIA, FTTH…)", icon: ListFilter },
  { value: "byDowntime", label: "By Downtime", description: "Customers who went down in a time range", icon: HistoryIcon },
];

type Props = {
  value: SmsMode;
  onChange: (mode: SmsMode) => void;
};

const ModeSelector = ({ value, onChange }: Props) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = value === m.value;
        return (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
            className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
              active
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-background hover:bg-muted/50"
            }`}
          >
            <div className={`rounded-lg p-2 ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-medium ${active ? "text-primary" : "text-foreground"}`}>{m.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default ModeSelector;
