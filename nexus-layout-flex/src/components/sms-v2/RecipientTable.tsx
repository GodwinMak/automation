import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Phone, AlertTriangle } from "lucide-react";
import type { Recipient } from "./types";

type Props = {
  recipients: Recipient[];
  loading: boolean;
  selectedKeys: Set<string>;
  onSelectedKeysChange: (next: Set<string>) => void;
  showDownAt?: boolean;
};

const formatDownAt = (iso?: string) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
};

const RecipientTable = ({ recipients, loading, selectedKeys, onSelectedKeysChange, showDownAt }: Props) => {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return recipients;
    const q = search.toLowerCase();
    return recipients.filter(
      (r) =>
        (r.customerName?.toLowerCase() ?? "").includes(q) ||
        (r.cid?.toLowerCase() ?? "").includes(q) ||
        (r.interface?.toLowerCase() ?? "").includes(q) ||
        (r.phoneNumber?.toLowerCase() ?? "").includes(q)
    );
  }, [recipients, search]);

  const withPhone = recipients.filter((r) => r.hasPhone).length;
  const coveragePct = recipients.length ? Math.round((withPhone / recipients.length) * 100) : 0;
  const lowCoverage = recipients.length > 0 && withPhone / recipients.length < 0.5;

  const toggle = (key: string, hasPhone: boolean) => {
    if (!hasPhone) return;
    const next = new Set(selectedKeys);
    next.has(key) ? next.delete(key) : next.add(key);
    onSelectedKeysChange(next);
  };

  const selectAllResolvable = () => {
    const next = new Set(selectedKeys);
    filtered.forEach((r) => r.hasPhone && next.add(r.key));
    onSelectedKeysChange(next);
  };

  const deselectAll = () => {
    const next = new Set(selectedKeys);
    filtered.forEach((r) => next.delete(r.key));
    onSelectedKeysChange(next);
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium">Recipients</p>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {selectedKeys.size} selected · {withPhone} of {recipients.length} have a phone number on file
          </p>
        )}
      </div>

      {!loading && recipients.length > 0 && (
        <div className="space-y-1">
          <Progress value={coveragePct} className="h-1.5" />
          {lowCoverage && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Less than half of this segment has a phone number on file — the billing sheet (client_db) may be stale for
              these customers.
            </p>
          )}
        </div>
      )}

      {!loading && recipients.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search by name, cid, interface, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[180px] border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <Button size="sm" variant="outline" onClick={selectAllResolvable}>
            Select all resolvable
          </Button>
          <Button size="sm" variant="outline" onClick={deselectAll}>
            Deselect all
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : recipients.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-8">
          No customers match the current filters yet.
        </p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>CID / Interface</TableHead>
                <TableHead>Switch</TableHead>
                <TableHead>Phone</TableHead>
                {showDownAt && <TableHead>Last Down</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.key} className={!r.hasPhone ? "opacity-60" : undefined}>
                  <TableCell>
                    {r.hasPhone ? (
                      <Checkbox
                        checked={selectedKeys.has(r.key)}
                        onCheckedChange={() => toggle(r.key, r.hasPhone)}
                      />
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Checkbox checked={false} disabled />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>No phone number on file — can't be selected.</TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{r.customerName || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {r.customerType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.cid || r.interface || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.switchName || "—"}</TableCell>
                  <TableCell>
                    {r.hasPhone ? (
                      <span className="flex items-center gap-1 text-xs">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {r.phoneNumber}
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        No phone on file
                      </Badge>
                    )}
                  </TableCell>
                  {showDownAt && (
                    <TableCell className="text-xs text-muted-foreground">{formatDownAt(r.lastDownAt)}</TableCell>
                  )}
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={showDownAt ? 7 : 6} className="text-center text-sm text-muted-foreground italic py-6">
                    No matches found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default RecipientTable;
