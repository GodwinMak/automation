import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Network, ArrowLeft } from "lucide-react";
import { L2VPNPathChain, L2VPNHop } from "@/components/L2VPNPathChain";
import { FavoriteButton } from "@/components/FavoriteButton";

type L2VPNCircuit = {
  customerName: string;
  status: "complete" | "needs-review" | "off-net" | "vpls";
  overallOperationalStatus: "up" | "down" | "mixed";
  path: string[];
  hops: L2VPNHop[];
  // True when this path only chains because a backup-neighbor matched, not
  // the primary — a real, confirmed pairing riding the protection path.
  viaBackupNeighbor?: boolean;
};

const statusPillClasses = (status: "up" | "down" | "mixed") => {
  if (status === "up") {
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  }
  if (status === "down") {
    return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
};

const ViewL2VPNCircuit = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const circuit: L2VPNCircuit | undefined = location.state?.circuit;
  // Input/output Mbps come off a per-interface policer match in the device
  // config, so it's often only actually present on one hop of a multi-hop
  // circuit (e.g. the access-side leg) rather than every hop — show the
  // first hop that has it as a circuit-level summary near the status pills.
  const capacityHop = circuit?.hops.find(
    (h) => h.inputMbps != null || h.outputMbps != null
  );
  // virtualCircuitId is the only stable identity an L2VPN circuit has (no
  // single customerinfos-style row like DIA/IPT/Shared/L3VPN) — see
  // cron/updateL2VPN.js's trackL2VPNCircuitStatusChanges, which uses the
  // same key for watch-listing and status-change tracking.
  const vcid = circuit?.hops[0]?.virtualCircuitId;

  if (!circuit) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">
            No circuit data to show — open this page from the L2VPN Circuits list.
          </p>
          <Button onClick={() => navigate("/l2vpn-circuits")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to L2VPN Circuits
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Network className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">L2VPN Circuit</h1>
              <p className="text-sm text-muted-foreground">
                Layer 2 circuit path across devices
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {vcid && (
              <FavoriteButton
                customerId={vcid}
                customerName={circuit.customerName}
                customerType="L2VPN"
                interface={vcid}
                cid={vcid}
                nbr={circuit.hops[0]?.neighbor || undefined}
              />
            )}
            <Button variant="outline" onClick={() => navigate("/l2vpn-circuits")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to List
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground mb-2">{circuit.customerName}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusPillClasses(
                circuit.overallOperationalStatus
              )}`}
            >
              {circuit.overallOperationalStatus.toUpperCase()}
            </span>
            {circuit.status === "needs-review" && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                Needs Review — path could not be fully chained
              </span>
            )}
            {circuit.status === "off-net" && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                Off-Net — leaves the network here
              </span>
            )}
            {circuit.status === "vpls" && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                VPLS — terminates into a PE mesh-group
              </span>
            )}
            {circuit.viaBackupNeighbor && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                Via backup-neighbor
              </span>
            )}
            {capacityHop && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-muted text-muted-foreground">
                {capacityHop.inputMbps != null && `Input ${capacityHop.inputMbps} Mbps`}
                {capacityHop.inputMbps != null && capacityHop.outputMbps != null && " · "}
                {capacityHop.outputMbps != null && `Output ${capacityHop.outputMbps} Mbps`}
              </span>
            )}
          </div>
        </div>

        {/* Path visual */}
        <div className="bg-card border border-border rounded-lg p-6 mb-8">
          <h3 className="text-lg font-semibold text-foreground mb-4">Layer 2 Path</h3>
          <L2VPNPathChain hops={circuit.hops} size="lg" connected={circuit.status === "complete"} />
          {circuit.status === "needs-review" && (
            <p className="text-sm text-muted-foreground mt-4">
              These endpoints share this customer's identity but the neighbor field on each
              hop didn't resolve to another device in this group — this could mean the far end
              hasn't been polled yet, a duplicate/stale circuit ID, or genuinely separate
              circuits with the same customer name.
            </p>
          )}
          {circuit.status === "off-net" && (
            <p className="text-sm text-muted-foreground mt-4">
              This circuit's neighbor is an IP address that doesn't match any device in our
              fleet — the far end genuinely lives outside our network (e.g. a wholesale or
              backhaul peer), so there's no other hop to chain it to.
            </p>
          )}
          {circuit.status === "vpls" && (
            <p className="text-sm text-muted-foreground mt-4">
              This circuit's virtual circuit ID matches a VPLS mesh-group configured on the PE
              it points to — it's a confirmed multipoint termination rather than a
              point-to-point pairing, so there's no single other device to chain it to.
            </p>
          )}
        </div>

        {/* Hop detail table */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">Hop Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {circuit.hops.map((hop, index) => (
              <div
                key={`${hop.switchName}-${index}`}
                className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-lg font-semibold text-foreground">{hop.switchName}</p>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      hop.operationalStatus === "up"
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                    }`}
                  >
                    {hop.operationalStatus?.toUpperCase() || "UNKNOWN"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Interface</p>
                    <p className="font-medium text-foreground">
                      {hop.interface}.{hop.unit}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Admin Status</p>
                    <p className="font-medium text-foreground">{hop.adminStatus || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">VLAN ID</p>
                    <p className="font-medium text-foreground">{hop.vlanId || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Virtual Circuit ID</p>
                    <p className="font-medium text-foreground">{hop.virtualCircuitId || "N/A"}</p>
                  </div>
                  {hop.inputMbps != null && (
                    <div>
                      <p className="text-muted-foreground">Input (Mbps)</p>
                      <p className="font-medium text-foreground">{hop.inputMbps}</p>
                    </div>
                  )}
                  {hop.outputMbps != null && (
                    <div>
                      <p className="text-muted-foreground">Output (Mbps)</p>
                      <p className="font-medium text-foreground">{hop.outputMbps}</p>
                    </div>
                  )}
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Neighbor</p>
                    <p className="font-medium text-foreground">{hop.neighbor || "N/A"}</p>
                  </div>
                  {hop.backupNeighbor && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Backup Neighbor</p>
                      <p className="font-medium text-foreground">{hop.backupNeighbor}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default ViewL2VPNCircuit;
