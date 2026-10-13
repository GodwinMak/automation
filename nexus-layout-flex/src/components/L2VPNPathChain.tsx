import { ArrowRight, EllipsisVertical } from "lucide-react";

export type L2VPNHop = {
  switchName: string;
  interface?: string;
  unit?: string;
  adminStatus?: string;
  operationalStatus?: string;
  vlanId?: string | null;
  virtualCircuitId?: string | null;
  neighbor?: string | null;
  backupNeighbor?: string | null;
  inputMbps?: number | null;
  outputMbps?: number | null;
};

type L2VPNPathChainProps = {
  hops: L2VPNHop[];
  size?: "sm" | "lg";
  // Whether these hops were actually confirmed as a connected chain (the
  // backend's edge-walk succeeded) vs just endpoints sharing a customer
  // identity that couldn't be linked (status "needs-review"). Drawing a
  // connecting arrow in the unconfirmed case asserts a link that was
  // explicitly NOT established — misleading even when every individual
  // fact shown is correct, e.g. two real interfaces on the same switch
  // both pointing at a neighbor that was never discovered. Defaults to
  // true so existing callers that don't pass it keep today's look.
  connected?: boolean;
};

// Renders a Layer 2 circuit as a row of device nodes, each colored by that
// hop's operationalStatus so a break anywhere along a multi-hop circuit is
// visible at a glance, without opening the detail view. When `connected` is
// true the nodes are joined by arrows (A -> B -> C) — a confirmed chain.
// When false, an ellipsis separator is used instead, deliberately NOT
// implying sequence/connectivity between endpoints that only share a
// customer identity. Same "hop chain" concept as ImpactAnalyzer's
// PathHops, rebuilt with Tailwind/shadcn tokens for consistency with the
// rest of the app instead of that component's inline-style theme tokens.
export const L2VPNPathChain = ({ hops, size = "sm", connected = true }: L2VPNPathChainProps) => {
  if (!hops || hops.length === 0) {
    return <span className="text-muted-foreground text-sm">No path data</span>;
  }

  const nodeClasses = (status?: string) => {
    const base =
      size === "lg"
        ? "px-3 py-2 text-sm rounded-lg border"
        : "px-2 py-1 text-xs rounded-md border whitespace-nowrap";
    if (status === "up") {
      return `${base} bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-200 dark:border-green-700`;
    }
    if (status === "down") {
      return `${base} bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-200 dark:border-red-700`;
    }
    return `${base} bg-muted text-muted-foreground border-border`;
  };

  const separatorClasses = size === "lg" ? "w-4 h-4 text-muted-foreground" : "w-3 h-3 text-muted-foreground";

  return (
    <div className="flex items-center flex-wrap gap-1">
      {hops.map((hop, index) => (
        <div key={`${hop.switchName}-${hop.interface}-${index}`} className="flex items-center gap-1">
          <span
            className={nodeClasses(hop.operationalStatus)}
            title={hop.interface ? `${hop.interface}.${hop.unit}` : undefined}
          >
            {hop.switchName}
          </span>
          {index < hops.length - 1 &&
            (connected ? (
              <ArrowRight className={separatorClasses} />
            ) : (
              <EllipsisVertical className={separatorClasses} />
            ))}
        </div>
      ))}
    </div>
  );
};

export default L2VPNPathChain;
