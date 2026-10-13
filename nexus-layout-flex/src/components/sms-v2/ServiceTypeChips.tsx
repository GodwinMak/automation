import React from "react";
import type { ServiceType } from "./types";

type Props = {
  options: ServiceType[];
  selected: ServiceType[];
  onChange: (next: ServiceType[]) => void;
};

// Toggle chips for picking a subset of service types — used under the
// switch and downtime panels, where a single dropdown wouldn't allow the
// "several types at once" case that a switch or a time range can span.
const ServiceTypeChips = ({ options, selected, onChange }: Props) => {
  const toggle = (type: ServiceType) => {
    if (selected.includes(type)) onChange(selected.filter((t) => t !== type));
    else onChange([...selected, type]);
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((type) => {
        const active = selected.includes(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => toggle(type)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted/50"
            }`}
          >
            {type}
          </button>
        );
      })}
    </div>
  );
};

export default ServiceTypeChips;
