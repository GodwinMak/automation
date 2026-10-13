import React from "react";
import SwitchCombobox from "./SwitchCombobox";
import ServiceTypeChips from "./ServiceTypeChips";
import { SWITCH_SERVICE_TYPES, ServiceType } from "./types";

type Props = {
  switchNames: string[];
  onSwitchNamesChange: (names: string[]) => void;
  serviceTypes: ServiceType[];
  onServiceTypesChange: (types: ServiceType[]) => void;
  highProfileOnly: boolean;
  onHighProfileOnlyChange: (next: boolean) => void;
};

const SwitchFilterPanel = ({
  switchNames,
  onSwitchNamesChange,
  serviceTypes,
  onServiceTypesChange,
  highProfileOnly,
  onHighProfileOnlyChange,
}: Props) => {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-sm font-medium">Switches</label>
        <SwitchCombobox value={switchNames} onChange={onSwitchNamesChange} />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Service types on these switches</label>
        <ServiceTypeChips options={SWITCH_SERVICE_TYPES} selected={serviceTypes} onChange={onServiceTypesChange} />
        <p className="text-xs text-muted-foreground italic">
          FTTH customers have no switch/location field on record and can't be targeted this way.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={highProfileOnly}
          onChange={(e) => onHighProfileOnlyChange(e.target.checked)}
          className="h-4 w-4"
        />
        High Profile customers only
      </label>
    </div>
  );
};

export default SwitchFilterPanel;
