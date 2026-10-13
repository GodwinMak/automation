import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Loader2, Router, ChevronDown, X } from "lucide-react";
import type { SwitchOption } from "./types";

type Props = {
  value: string[];
  onChange: (names: string[]) => void;
  placeholder?: string;
};

// Inline expanding, multi-select switch picker — deliberately NOT a floating
// Popover (a Popover renders its list in a portal that overlaps whatever
// sits below the trigger; this instead grows the panel itself via the
// 0fr->1fr grid trick, pushing surrounding content down instead of covering
// it) and deliberately keeps the panel open across picks so several
// switches can be checked in one pass instead of one-at-a-time.
const SwitchCombobox = ({ value, onChange, placeholder = "Select switches…" }: Props) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [switches, setSwitches] = useState<SwitchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${PRODUCTION_URL}/sms/v2/switches`, {
          params: search ? { search } : {},
          withCredentials: true,
        });
        setSwitches(res.data.switches || []);
      } catch {
        setSwitches([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [search, open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name]);
  };

  const triggerLabel =
    value.length === 0 ? placeholder : value.length === 1 ? value[0] : `${value.length} switches selected`;

  return (
    <div ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        className="w-full justify-between font-normal"
      >
        <span className="flex items-center gap-2 truncate">
          <Router className="h-4 w-4 shrink-0 text-muted-foreground" />
          {triggerLabel}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </Button>

      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {value.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1 bg-muted border border-border rounded-full px-2.5 py-0.5 text-xs font-medium"
            >
              {name}
              <button onClick={() => toggle(name)} className="hover:text-red-500 transition-colors">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Clear all
          </button>
        </div>
      )}

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <Command shouldFilter={false} className="border border-border rounded-lg">
            <CommandInput placeholder="Search switches…" value={search} onValueChange={setSearch} />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <CommandEmpty>No switches found.</CommandEmpty>
                  <CommandGroup>
                    {switches.map((s) => (
                      <CommandItem key={s.switchName} value={s.switchName} onSelect={() => toggle(s.switchName)}>
                        <Checkbox checked={value.includes(s.switchName)} className="mr-2 pointer-events-none" />
                        <span className="flex-1 truncate">{s.switchName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {s.totalCustomers} customer{s.totalCustomers !== 1 ? "s" : ""}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </div>
      </div>
    </div>
  );
};

export default SwitchCombobox;
