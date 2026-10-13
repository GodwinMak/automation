import React from "react";
import { Button } from "@/components/ui/button";
import ServiceTypeChips from "./ServiceTypeChips";
import SwitchCombobox from "./SwitchCombobox";
import { ALL_SERVICE_TYPES, ServiceType } from "./types";

export type DowntimeRange = { startDate: string; endDate: string };

const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const PRESETS: { label: string; hours: number }[] = [
  { label: "Last 24h", hours: 24 },
  { label: "Last 3 days", hours: 72 },
  { label: "Last 7 days", hours: 168 },
  { label: "Last 30 days", hours: 720 },
];

type Props = {
  range: DowntimeRange;
  onRangeChange: (range: DowntimeRange) => void;
  serviceTypes: ServiceType[];
  onServiceTypesChange: (types: ServiceType[]) => void;
  switchNames: string[];
  onSwitchNamesChange: (names: string[]) => void;
};

const DowntimeFilterPanel = ({
  range,
  onRangeChange,
  serviceTypes,
  onServiceTypesChange,
  switchNames,
  onSwitchNamesChange,
}: Props) => {
  const applyPreset = (hours: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    onRangeChange({ startDate: toLocalInputValue(start), endDate: toLocalInputValue(end) });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <Button key={p.label} size="sm" variant="outline" className="text-xs h-7" onClick={() => applyPreset(p.hours)}>
            {p.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">From</label>
          <input
            type="datetime-local"
            value={range.startDate}
            onChange={(e) => onRangeChange({ ...range, startDate: e.target.value })}
            className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">To</label>
          <input
            type="datetime-local"
            value={range.endDate}
            onChange={(e) => onRangeChange({ ...range, endDate: e.target.value })}
            className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Service types</label>
        <ServiceTypeChips options={ALL_SERVICE_TYPES} selected={serviceTypes} onChange={onServiceTypesChange} />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Switches (optional)</label>
        <SwitchCombobox value={switchNames} onChange={onSwitchNamesChange} placeholder="Any switch" />
      </div>
    </div>
  );
};

export default DowntimeFilterPanel;
