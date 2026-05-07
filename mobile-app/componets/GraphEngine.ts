// utils/GraphEngine.ts

import { ifaceCapacity, trafficUtil, fmtMetric, ifaceLabel } from "./formatters";
import { isAGGNode, isPENode, isBNGNode, isCoreNode } from "./Constants";
import type { PathData } from "./isis";

// ─────────────────────────────────────────────────────────────────────────────
//  GRAPH ENGINE (edge tuple: [a,b,lvl,iface,metric,portSpeed,state,in_bps,out_bps])
// ─────────────────────────────────────────────────────────────────────────────

interface AdjacencyEntry {
  n: string;
  lvl: number;
  iface: string;
  cap: number;
  metric: number;
  portSpeed: number;
  input_bps: number;
  output_bps: number;
}

interface LinkCapData {
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

export class Graph {
  adj: Record<string, AdjacencyEntry[]> = {};
  nodes: Set<string> = new Set();
  linkCap: Record<string, LinkCapData> = {};

  constructor(edges: any[]) {
    edges.forEach((edge) => {
      const [a, b, lvl, iface, metric, portSpeed, , input_bps, output_bps] =
        edge;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const cap = ifaceCapacity(iface, portSpeed);
      const rawM = Number(metric);
      const m = isFinite(rawM) && rawM > 0 ? rawM : lvl === 3 ? 1 : 10;
      const ibps = parseFloat(input_bps) || 0;
      const obps = parseFloat(output_bps) || 0;

      if (!this.adj[a]) this.adj[a] = [];
      if (!this.adj[b]) this.adj[b] = [];

      this.adj[a].push({
        n: b,
        lvl,
        iface,
        cap,
        metric: m,
        portSpeed,
        input_bps: ibps,
        output_bps: obps,
      });
      this.adj[b].push({
        n: a,
        lvl,
        iface,
        cap,
        metric: m,
        portSpeed,
        input_bps: obps,
        output_bps: ibps,
      });

      if (!this.linkCap[key]) {
        this.linkCap[key] = {
          iface,
          cap,
          totalCap: cap,
          count: 1,
          metric: m,
          portSpeed,
          input_bps: ibps,
          output_bps: obps,
          ifaces: [{ iface, cap, metric: m, portSpeed, input_bps: ibps, output_bps: obps }],
        };
      } else {
        const lc = this.linkCap[key];
        lc.count++;
        lc.totalCap += cap;
        lc.input_bps = (lc.input_bps || 0) + ibps;
        lc.output_bps = (lc.output_bps || 0) + obps;
        lc.ifaces.push({
          iface,
          cap,
          metric: m,
          portSpeed,
          input_bps: ibps,
          output_bps: obps,
        });
        if (cap > lc.cap) {
          lc.cap = cap;
          lc.iface = iface;
        }
        if (m < lc.metric) lc.metric = m;
      }

      this.nodes.add(a);
      this.nodes.add(b);
    });
  }

  neighbors(n: string): string[] {
    const s = new Set<string>();
    return (this.adj[n] || [])
      .filter((e) => {
        if (s.has(e.n)) return false;
        s.add(e.n);
        return true;
      })
      .map((e) => e.n);
  }

  degree(n: string): number {
    return new Set((this.adj[n] || []).map((e) => e.n)).size;
  }

  allNodes(): string[] {
    return [...this.nodes];
  }

  bfs(start: string): Record<string, number> {
    if (!this.adj[start]) return {};
    const dist: Record<string, number> = { [start]: 0 };
    const q = [start];
    let i = 0;

    while (i < q.length) {
      const cur = q[i++];
      for (const nb of this.neighbors(cur)) {
        if (!(nb in dist)) {
          dist[nb] = dist[cur] + 1;
          q.push(nb);
        }
      }
    }

    return dist;
  }

  dijkstra(start: string): Record<string, PathData> {
    if (!this.adj[start]) return {};

    const INF = Infinity;
    const cost: Record<string, number> = { [start]: 0 };
    const hops: Record<string, number> = { [start]: 0 };
    const visited = new Set<string>();
    const pq: Array<{ n: string; c: number; h: number }> = [{ n: start, c: 0, h: 0 }];

    while (pq.length) {
      pq.sort((a, b) => a.c - b.c);
      const { n: cur, c: curC, h: curH } = pq.shift()!;

      if (visited.has(cur)) continue;
      visited.add(cur);

      for (const e of this.adj[cur] || []) {
        const nc = curC + e.metric;
        const nh = curH + 1;
        if (nc < (cost[e.n] ?? INF)) {
          cost[e.n] = nc;
          hops[e.n] = nh;
          pq.push({ n: e.n, c: nc, h: nh });
        }
      }
    }

    const r: Record<string, PathData> = {};
    for (const n of Object.keys(cost)) {
      r[n] = { hops: hops[n], cost: cost[n] };
    }
    return r;
  }

  dijkstraWithPath(start: string): Record<string, PathData & { path?: string[] }> {
    if (!this.adj[start]) return {};

    const INF = Infinity;
    const cost: Record<string, number> = { [start]: 0 };
    const hops: Record<string, number> = { [start]: 0 };
    const prev: Record<string, string | null> = { [start]: null };
    const visited = new Set<string>();
    const pq: Array<{ n: string; c: number; h: number }> = [{ n: start, c: 0, h: 0 }];

    while (pq.length) {
      pq.sort((a, b) => a.c - b.c);
      const { n: cur, c: curC, h: curH } = pq.shift()!;

      if (visited.has(cur)) continue;
      visited.add(cur);

      for (const e of this.adj[cur] || []) {
        const nc = curC + e.metric;
        const nh = curH + 1;
        if (nc < (cost[e.n] ?? INF)) {
          cost[e.n] = nc;
          hops[e.n] = nh;
          prev[e.n] = cur;
          pq.push({ n: e.n, c: nc, h: nh });
        }
      }
    }

    const getPath = (dest: string): string[] | null => {
      if (!(dest in cost)) return null;
      const p: string[] = [];
      let cur: string | null = dest;
      while (cur !== null) {
        p.unshift(cur);
        cur = prev[cur] ?? null;
      }
      return p;
    };

    const r: Record<string, PathData & { path?: string[] }> = {};
    for (const n of Object.keys(cost)) {
      r[n] = {
        hops: hops[n],
        cost: cost[n],
        path: getPath(n) || undefined,
      };
    }
    return r;
  }

  components(): string[][] {
    const vis = new Set<string>();
    const comps: string[][] = [];

    for (const n of this.allNodes()) {
      if (!vis.has(n)) {
        const c = Object.keys(this.bfs(n));
        c.forEach((x) => vis.add(x));
        comps.push(c);
      }
    }

    return comps;
  }

  getInterfaces(): Array<{
    nodeA: string;
    nodeB: string;
    iface: string;
    capacity: number;      // port capacity in Gbps
    metric: number;
    portSpeed: number;     // raw port speed
    input_bps: number;
    output_bps: number;
    utilPercent: number | null; // traffic utilisation percentage
  }> {
    const seen = new Set<string>();
    const result: ReturnType<Graph['getInterfaces']> = [];

    for (const [nodeA, neighbors] of Object.entries(this.adj)) {
      for (const nb of neighbors) {
        const nodeB = nb.n;
        const iface = nb.iface;
        // Sort node names to get a canonical pair key
        const [small, large] = [nodeA, nodeB].sort();
        const key = `${small}|${large}|${iface}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const util = trafficUtil(nb.input_bps, nb.output_bps, nb.portSpeed);
        result.push({
          nodeA: small,
          nodeB: large,
          iface,
          capacity: ifaceCapacity(iface, nb.portSpeed),
          metric: nb.metric,
          portSpeed: nb.portSpeed,
          input_bps: nb.input_bps,
          output_bps: nb.output_bps,
          utilPercent: util,
        });
      }
    }
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ISIS IMPACT ANALYZER
// ─────────────────────────────────────────────────────────────────────────────

export class ISISImpactAnalyzer {
  baseGraph: Graph;
  allEdges: any[];
  activeEdges: any[];
  downLinks: any[];

  constructor(edges: any[], downLinks: any[] = []) {
    const dk = new Set(
      downLinks.map(({ a, b, iface }: any) => {
        const p = a < b ? `${a}|${b}` : `${b}|${a}`;
        return iface ? `${p}|${iface}` : p;
      })
    );

    const active = edges.filter(([a, b, , iface, , , status]: any) => {
      const p = a < b ? `${a}|${b}` : `${b}|${a}`;
      const ik = iface ? `${p}|${iface}` : p;
      return status === "Up" && !dk.has(ik) && !dk.has(p);
    });

    this.baseGraph = new Graph(active);
    this.allEdges = edges;
    this.activeEdges = active;
    this.downLinks = downLinks;
  }

  analyzeCurrentDown() {
    if (this.downLinks.length === 0)
      return {
        downCount: 0,
        severity: "LOW",
        isolated: [],
        partitioned: false,
        partGroups: [],
        pathImpact: [],
        avgInf: 0,
        maxInf: 0,
        loadIncrease: [],
        perLink: [],
        aggpe: {},
        aggReach: [],
        linkCong: { flows: [], total: 0 },
        recs: [],
      };

    const fg = new Graph(this.allEdges);
    const dg = this.baseGraph;
    const fc = fg.components().length;
    const dc = dg.components().length;
    const partitioned = dc > fc;

    const isolated: any[] = [];
    for (const n of fg.allNodes()) {
      if ((!dg.adj[n] || dg.degree(n) === 0) && fg.degree(n) > 0) {
        isolated.push({
          node: n,
          reason: "All adjacencies DOWN — completely unreachable",
        });
      }
    }

    const dgComps = dg.components();
    const dgMainSize =
      dgComps.length > 0 ? Math.max(...dgComps.map((c) => c.length)) : 0;
    const dgMainSet = new Set(dgComps.find((c) => c.length === dgMainSize) || []);

    const alreadyCaught = new Set(isolated.map((i) => i.node));
    for (const n of fg.allNodes()) {
      if (alreadyCaught.has(n)) continue;
      if (dg.adj[n] && dg.degree(n) > 0 && !dgMainSet.has(n)) {
        isolated.push({
          node: n,
          reason: "Partitioned from main topology by current outage",
        });
      }
    }

    const pg: string[][] = [];
    if (partitioned) {
      dgComps.filter((c) => c.length < dgMainSize).forEach((c) => pg.push(c));
    }

    const perLink = this.downLinks.map(({ a, b, iface: di, port_speed, since, duration }: any) => {
      const e = this.allEdges.find(
        ([x, y]: any) => (x === a && y === b) || (x === b && y === a)
      );
      const level = e ? e[2] : null;
      const iface = di || (e ? e[3] : null);
      const cap = ifaceCapacity(iface, port_speed);
      const capLabel = ifaceLabel(iface, port_speed);
      const metric = e ? e[4] : null;

      const fd2 = fg.dijkstra(a);
      const dd3 = dg.adj[a] ? dg.dijkstra(a) : {};
      const pb = fd2[b];
      const pa = dd3[b];

      let impact = "LOW";
      if (!pa && pb) impact = "CRITICAL";
      else if (pb && pa && (pa.hops - pb.hops) >= 2) impact = "HIGH";
      else if (level && level >= 2) impact = "HIGH";
      else if (pb && pa && (pa.hops - pb.hops) >= 1) impact = "MEDIUM";

      return {
        a,
        b,
        since,
        duration,
        level,
        iface,
        cap,
        capLabel,
        metric,
        impact,
        trafficUtilPct: null,
        edgeInputBps: 0,
        edgeOutputBps: 0,
        linkIsolated: [],
        linkPartitioned: false,
        linkPartitionGroups: [],
      };
    });

    let severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (isolated.length > 0 || partitioned) severity = "CRITICAL";
    else if (perLink.some((l: any) => l.impact === "CRITICAL")) severity = "CRITICAL";

    return {
      downCount: this.downLinks.length,
      severity,
      isolated,
      partitioned,
      partGroups: pg,
      pathImpact: [],
      avgInf: 0,
      maxInf: 0,
      loadIncrease: [],
      perLink,
      aggpe: {},
      aggReach: [],
      linkCong: { flows: [], total: 0 },
      recs: [],
    };
  }
}