// Type definitions for ISIS analysis

export interface EdgeData {
  nodeA: string;
  nodeB: string;
  level: number;
  iface: string;
  metric: number;
  portSpeed: number;
  status: "Up" | "Down";
  input_bps: number;
  output_bps: number;
}

export interface DownLink {
  a: string;
  b: string;
  iface: string;
  port_speed?: number;
  since: string;
  duration: string;
}

export interface LinkCapacity {
  iface: string;
  cap: number;
  totalCap: number;
  count: number;
  metric: number;
  portSpeed: number;
  input_bps: number;
  output_bps: number;
  ifaces: Array<{
    iface: string;
    cap: number;
    metric: number;
    portSpeed: number;
    input_bps: number;
    output_bps: number;
  }>;
}

export interface AdjacencyData {
  n: string;
  lvl: number;
  iface: string;
  cap: number;
  metric: number;
  portSpeed: number;
  input_bps: number;
  output_bps: number;
}

export interface PathData {
  hops: number;
  cost: number;
  path?: string[];
}

export interface IsolatedNode {
  node: string;
  reason: string;
  self?: boolean;
}

export interface PathImpactItem {
  dest: string;
  beforeHops: number | null;
  afterHops: number | null;
  beforeCost: number;
  afterCost: number | null;
  hopDiff: number | null;
  costDiff: number | null;
  type: "unreachable" | "inflated" | "ok";
}

export interface PathImpact {
  source: string;
  affected: PathImpactItem[];
  totalAffected: number;
}

export interface TrafficAlert {
  key: string;
  nodeA: string;
  nodeB: string;
  util: number;
  cap: number;
  iface: string;
  inBps: number;
  outBps: number;
  count: number;
}

export interface FailureDetail {
  key: string;
  a: string;
  b: string;
  since: string;
  duration: string;
  level: number;
  iface: string;
  cap: number;
  capLabel: string;
  metric: number | null;
  parallelCount: number;
  remainingCount: number;
  remainingCap: number;
  aIsolated: boolean;
  bIsolated: boolean;
  pathBefore: PathData | null;
  pathAfter: PathData | null;
  hopInflation: number | null;
  costInflation: number | null;
  impact: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  linkIsolated: IsolatedNode[];
  linkPartitioned: boolean;
  linkPartitionGroups: string[][];
  trafficUtilPct: number | null;
  edgeInputBps: number;
  edgeOutputBps: number;
}

export interface CurrentDownResult {
  downCount: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  isolated: IsolatedNode[];
  partitioned: boolean;
  partGroups: string[][];
  pathImpact: PathImpact[];
  avgInf: number;
  maxInf: number;
  loadIncrease: any[];
  perLink: FailureDetail[];
  aggpe: any;
  aggReach: any[];
  linkCong: any;
  recs: any[];
}

export interface ImpactDataResponse {
  allEdges: EdgeData[];
  downLinks: DownLink[];
  nodeIPs: Record<string, string>;
}

export interface AnalysisNodeResult {
  target: string;
  degree: number;
  neighbors: string[];
  maxLvl: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  score: number;
  isolated: IsolatedNode[];
  partitioned: boolean;
  pathImpact: PathImpact[];
  isolated: IsolatedNode[];
  partitioned: boolean;
  partitionedGroups: string[][];
  avgHopInf: number;
  maxHopInf: number;
  avgCostInf: number;
  maxCostInf: number;
}
