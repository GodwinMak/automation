import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import * as d3 from "d3";
import { PRODUCTION_URL } from "@/utils/Api";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const MIN_NODE_RADIUS = 16;
const NODE_LABEL_OFFSET = 26;
const LINK_STROKE_WIDTH = 2;

const EDGE_UP_COLOR = "#22c55e";
const EDGE_DOWN_COLOR = "#ef4444";

const FORCE_VIEW = "force";
const GEO_VIEW = "geo";

type TopologyNode = {
  id: string;
  ip: string | null;
  lat: number | null;
  long: number | null;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

type TopologyLink = {
  source: string | TopologyNode;
  target: string | TopologyNode;
  interface: string;
  state: "Up" | "Down" | string;
  last_seen?: string | null;
  last_checked?: string | null;
};

type TopologyResponse = {
  nodes: TopologyNode[];
  links: TopologyLink[];
};

type ViewMode = typeof FORCE_VIEW | typeof GEO_VIEW;

type TooltipData = {
  type: "node" | "link";
  title: string;
  subtitle?: string;
  meta?: string;
};

const buildLinkKey = (link: TopologyLink) => {
  const sourceId = typeof link.source === "string" ? link.source : link.source.id;
  const targetId = typeof link.target === "string" ? link.target : link.target.id;
  return `${sourceId}::${targetId}::${link.interface}`;
};

const normalizeId = (value: string) => value.trim();

const hasGeoCoordinates = (node: TopologyNode) =>
  Number.isFinite(node.lat) && Number.isFinite(node.long);

const formatTimestamp = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

export default function Topology() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const simulationRef = useRef<d3.Simulation<TopologyNode, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const nodesRef = useRef<TopologyNode[]>([]);
  const linksRef = useRef<TopologyLink[]>([]);

  const [viewMode, setViewMode] = useState<ViewMode>(FORCE_VIEW);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dimensions, setDimensions] = useState({ width: 1200, height: 720 });

  const hasGeoData = useMemo(
    () => nodesRef.current.some(hasGeoCoordinates),
    [nodesRef.current.length]
  );

  const updateTooltip = (event: MouseEvent, data?: TooltipData | null) => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;

    if (!data) {
      tooltip.style.opacity = "0";
      return;
    }

    const { clientX, clientY } = event;
    tooltip.style.opacity = "1";
    tooltip.style.transform = "translate(0, 0)";
    tooltip.style.left = `${clientX + 16}px`;
    tooltip.style.top = `${clientY + 16}px`;

    tooltip.innerHTML = `
      <div class="text-xs font-semibold text-foreground">${data.title}</div>
      ${data.subtitle ? `<div class="text-[11px] text-muted-foreground">${data.subtitle}</div>` : ""}
      ${data.meta ? `<div class="mt-1 text-[11px] text-muted-foreground">${data.meta}</div>` : ""}
    `;
  };

  const hideTooltip = () => updateTooltip(new MouseEvent("mouseleave"), null);

  const setupSvg = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.attr("viewBox", `0 0 ${dimensions.width} ${dimensions.height}`);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("data-layer", "root");

    const linkGroup = g.append("g").attr("data-layer", "links");
    const nodeGroup = g.append("g").attr("data-layer", "nodes");
    const labelGroup = g.append("g").attr("data-layer", "labels");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });

    zoomRef.current = zoom;
    svg.call(zoom as d3.ZoomBehavior<SVGSVGElement, unknown>);

    svg.on("mouseleave", () => hideTooltip());

    const simulation = d3
      .forceSimulation<TopologyNode>()
      .force(
        "link",
        d3
          .forceLink<TopologyNode, TopologyLink>()
          .id((d) => d.id)
          .distance(140)
          .strength(0.25)
      )
      .force("charge", d3.forceManyBody().strength(-360))
      .force("center", d3.forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force("collide", d3.forceCollide(32))
      .alphaDecay(0.05);

    simulation.on("tick", () => {
      linkGroup
        .selectAll<SVGLineElement, TopologyLink>("line")
        .attr("x1", (d) => (d.source as TopologyNode).x || 0)
        .attr("y1", (d) => (d.source as TopologyNode).y || 0)
        .attr("x2", (d) => (d.target as TopologyNode).x || 0)
        .attr("y2", (d) => (d.target as TopologyNode).y || 0);

      nodeGroup
        .selectAll<SVGCircleElement, TopologyNode>("circle")
        .attr("cx", (d) => d.x || 0)
        .attr("cy", (d) => d.y || 0);

      labelGroup
        .selectAll<SVGTextElement, TopologyNode>("text")
        .attr("x", (d) => (d.x || 0) + NODE_LABEL_OFFSET)
        .attr("y", (d) => (d.y || 0) + 4);

      nodesRef.current.forEach((node) => {
        if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
          positionsRef.current.set(node.id, { x: node.x!, y: node.y! });
        }
      });
    });

    simulationRef.current = simulation;
  }, [dimensions.width, dimensions.height]);

  const applyGeoLayout = useCallback(
    (nodes: TopologyNode[]) => {
      const svgEl = svgRef.current;
      if (!svgEl) return;

      const width = dimensions.width;
      const height = dimensions.height;
      const padding = 48;

      const availableNodes = nodes.filter(hasGeoCoordinates);
      if (availableNodes.length === 0) return;

      const latExtent = d3.extent(availableNodes, (d) => d.lat ?? 0) as [number, number];
      const lonExtent = d3.extent(availableNodes, (d) => d.long ?? 0) as [number, number];

      const xScale = d3
        .scaleLinear()
        .domain(lonExtent)
        .range([padding, width - padding]);

      const yScale = d3
        .scaleLinear()
        .domain(latExtent)
        .range([height - padding, padding]);

      nodes.forEach((node) => {
        if (hasGeoCoordinates(node)) {
          node.x = xScale(node.long as number);
          node.y = yScale(node.lat as number);
        } else {
          const last = positionsRef.current.get(node.id);
          node.x = last?.x ?? width / 2;
          node.y = last?.y ?? height / 2;
        }
      });
    },
    [dimensions.width, dimensions.height]
  );

  const updateGraph = useCallback(
    (data: TopologyResponse) => {
      const svgEl = svgRef.current;
      if (!svgEl) return;

      const svg = d3.select(svgEl);
      const linkGroup = svg.select<SVGGElement>("g[data-layer='links']");
      const nodeGroup = svg.select<SVGGElement>("g[data-layer='nodes']");
      const labelGroup = svg.select<SVGGElement>("g[data-layer='labels']");

      const resolveNodeId = (value: string | TopologyNode) =>
        normalizeId(typeof value === "string" ? value : value.id);

      const nodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
      const seedNodeMap = new Map<string, TopologyNode>();

      data.nodes.forEach((node) => {
        const normalizedId = normalizeId(node.id);
        const existing = nodeById.get(normalizedId);
        if (existing) {
          existing.ip = node.ip ?? null;
          existing.lat = node.lat ?? null;
          existing.long = node.long ?? null;
          seedNodeMap.set(normalizedId, { ...existing, id: normalizedId });
          return;
        }

        const cached = positionsRef.current.get(normalizedId);
        seedNodeMap.set(normalizedId, {
          ...node,
          id: normalizedId,
          x: cached?.x ?? dimensions.width / 2,
          y: cached?.y ?? dimensions.height / 2,
        });
      });

      const nextLinks = data.links.map((link) => ({
        ...link,
        source: resolveNodeId(link.source),
        target: resolveNodeId(link.target),
      }));

      nextLinks.forEach((link) => {
        const sourceId = resolveNodeId(link.source);
        const targetId = resolveNodeId(link.target);

        if (!seedNodeMap.has(sourceId)) {
          const cached = positionsRef.current.get(sourceId);
          seedNodeMap.set(sourceId, {
            id: sourceId,
            ip: null,
            lat: null,
            long: null,
            x: cached?.x ?? dimensions.width / 2,
            y: cached?.y ?? dimensions.height / 2,
          });
        }

        if (!seedNodeMap.has(targetId)) {
          const cached = positionsRef.current.get(targetId);
          seedNodeMap.set(targetId, {
            id: targetId,
            ip: null,
            lat: null,
            long: null,
            x: cached?.x ?? dimensions.width / 2,
            y: cached?.y ?? dimensions.height / 2,
          });
        }
      });

      const nextNodes = Array.from(seedNodeMap.values());

      const nodeIds = new Set(nextNodes.map((node) => node.id));
      const safeLinks = nextLinks.filter((link) => {
        const sourceId = resolveNodeId(link.source);
        const targetId = resolveNodeId(link.target);
        if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
          console.warn("Topology link dropped: node not found", link);
          return false;
        }
        return true;
      });

      nodesRef.current = nextNodes;
      linksRef.current = safeLinks;

      const nodeByNextId = new Map(nextNodes.map((node) => [node.id, node]));
      const fixedLinks = safeLinks
        .map((link) => {
          const sourceId = resolveNodeId(link.source);
          const targetId = resolveNodeId(link.target);
          const source = nodeByNextId.get(sourceId);
          const target = nodeByNextId.get(targetId);
          if (!source || !target) return null;
          return { ...link, source, target } as TopologyLink;
        })
        .filter(Boolean) as TopologyLink[];

      linksRef.current = fixedLinks;

      const linkSelection = linkGroup
        .selectAll<SVGLineElement, TopologyLink>("line")
        .data(fixedLinks, buildLinkKey);

      linkSelection.exit().remove();

      const linkEnter = linkSelection
        .enter()
        .append("line")
        .attr("stroke-width", LINK_STROKE_WIDTH)
        .attr("stroke-linecap", "round")
        .on("mousemove", (event, link) => {
          updateTooltip(event, {
            type: "link",
            title: `${typeof link.source === "string" ? link.source : link.source.id} → ${typeof link.target === "string" ? link.target : link.target.id}`,
            subtitle: link.interface,
            meta: link.last_seen ? `Last seen: ${formatTimestamp(link.last_seen)}` : undefined,
          });
        })
        .on("mouseleave", () => hideTooltip());

      linkSelection
        .merge(linkEnter)
        .attr("stroke", (d) => (d.state === "Up" ? EDGE_UP_COLOR : EDGE_DOWN_COLOR))
        .attr("stroke-dasharray", (d) => (d.state === "Up" ? "0" : "6 6"))
        .attr("opacity", 0.9);

      const nodeSelection = nodeGroup
        .selectAll<SVGCircleElement, TopologyNode>("circle")
        .data(nextNodes, (d) => d.id);

      nodeSelection.exit().remove();

      const nodeEnter = nodeSelection
        .enter()
        .append("circle")
        .attr("r", MIN_NODE_RADIUS)
        .attr("fill", "#1e293b")
        .attr("stroke", "#38bdf8")
        .attr("stroke-width", 2)
        .on("mousemove", (event, node) => {
          updateTooltip(event, {
            type: "node",
            title: node.id,
            subtitle: node.ip ? `IP: ${node.ip}` : "IP unavailable",
            meta: hasGeoCoordinates(node) ? `Lat ${node.lat}, Long ${node.long}` : undefined,
          });
        })
        .on("mouseleave", () => hideTooltip());

      const labelSelection = labelGroup
        .selectAll<SVGTextElement, TopologyNode>("text")
        .data(nextNodes, (d) => d.id);

      labelSelection.exit().remove();

      const labelEnter = labelSelection
        .enter()
        .append("text")
        .attr("font-size", 12)
        .attr("fill", "#cbd5e1")
        .attr("pointer-events", "none")
        .text((d) => d.id);

      labelSelection.merge(labelEnter).text((d) => d.id);

      const simulation = simulationRef.current;
      if (!simulation) return;

      const linkForce = simulation.force("link") as d3.ForceLink<TopologyNode, TopologyLink>;
      linkForce.links(fixedLinks);

      simulation.nodes(nextNodes);

      if (viewMode === GEO_VIEW && hasGeoData) {
        simulation.stop();
        applyGeoLayout(nextNodes);
        linkGroup
          .selectAll<SVGLineElement, TopologyLink>("line")
          .attr("x1", (d) => (d.source as TopologyNode).x || 0)
          .attr("y1", (d) => (d.source as TopologyNode).y || 0)
          .attr("x2", (d) => (d.target as TopologyNode).x || 0)
          .attr("y2", (d) => (d.target as TopologyNode).y || 0);

        nodeGroup
          .selectAll<SVGCircleElement, TopologyNode>("circle")
          .attr("cx", (d) => d.x || 0)
          .attr("cy", (d) => d.y || 0);

        labelGroup
          .selectAll<SVGTextElement, TopologyNode>("text")
          .attr("x", (d) => (d.x || 0) + NODE_LABEL_OFFSET)
          .attr("y", (d) => (d.y || 0) + 4);
      } else {
        const drag = d3
          .drag<SVGCircleElement, TopologyNode>()
          .on("start", (event, node) => {
            if (!event.active) simulation.alphaTarget(0.25).restart();
            node.fx = node.x;
            node.fy = node.y;
          })
          .on("drag", (event, node) => {
            node.fx = event.x;
            node.fy = event.y;
          })
          .on("end", (event, node) => {
            if (!event.active) simulation.alphaTarget(0.05);
            node.fx = null;
            node.fy = null;
          });

        nodeGroup.selectAll<SVGCircleElement, TopologyNode>("circle").call(drag);
        simulation.alpha(0.4).restart();
      }
    },
    [applyGeoLayout, dimensions.height, dimensions.width, hasGeoData, viewMode]
  );

  const fetchTopology = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.get<TopologyResponse>(
        `${PRODUCTION_URL}/isis-adjacency/topology`
      );
      updateGraph(response.data);
      setLastUpdated(new Date());
    } catch (fetchError) {
      setError("Failed to load topology data.");
      console.error(fetchError);
    } finally {
      setLoading(false);
    }
  }, [updateGraph]);

  useEffect(() => {
    setupSvg();
  }, [setupSvg]);

  useEffect(() => {
    fetchTopology();
    const interval = window.setInterval(fetchTopology, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchTopology]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (svgEl) {
      d3.select(svgEl).attr("viewBox", `0 0 ${dimensions.width} ${dimensions.height}`);
    }

    const simulation = simulationRef.current;
    if (!simulation) return;

    simulation.force("center", d3.forceCenter(dimensions.width / 2, dimensions.height / 2));
    simulation.alpha(0.4).restart();
  }, [dimensions]);

  useEffect(() => {
    if (!hasGeoData || viewMode !== GEO_VIEW) return;
    applyGeoLayout(nodesRef.current);
  }, [applyGeoLayout, hasGeoData, viewMode]);

  const handleResetZoom = () => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom) return;

    d3.select(svgEl)
      .transition()
      .duration(500)
      .call(zoom.transform, d3.zoomIdentity);
  };

  const stats = useMemo(() => {
    const totalNodes = nodesRef.current.length;
    const totalLinks = linksRef.current.length;
    const downLinks = linksRef.current.filter((link) => link.state !== "Up").length;
    return { totalNodes, totalLinks, downLinks };
  }, [lastUpdated]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Network Topology</h1>
          <p className="text-sm text-muted-foreground">
            Live IS-IS adjacency map with real-time link health.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm shadow-sm">
            <span className="text-muted-foreground">Nodes</span>
            <span className="font-semibold text-foreground">{stats.totalNodes}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm shadow-sm">
            <span className="text-muted-foreground">Links</span>
            <span className="font-semibold text-foreground">{stats.totalLinks}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm shadow-sm">
            <span className="text-muted-foreground">Down</span>
            <span className="font-semibold text-destructive">{stats.downLinks}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-sm">
            <span className="text-muted-foreground">Last updated</span>
            <span className="font-semibold text-foreground">
              {lastUpdated ? lastUpdated.toLocaleTimeString() : "--"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-sm">
          <button
            type="button"
            onClick={() => setViewMode(FORCE_VIEW)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              viewMode === FORCE_VIEW
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Force layout
          </button>
          <button
            type="button"
            onClick={() => setViewMode(GEO_VIEW)}
            disabled={!hasGeoData}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              viewMode === GEO_VIEW
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            } ${!hasGeoData ? "cursor-not-allowed opacity-50" : ""}`}
          >
            Geo layout
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={fetchTopology}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition hover:bg-accent"
          >
            Refresh now
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition hover:bg-accent"
          >
            Reset zoom
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {loading && (
          <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
            Loading topology...
          </div>
        )}
        {!loading && error && (
          <div className="flex h-[70vh] items-center justify-center text-sm text-destructive">
            {error}
          </div>
        )}
        {!loading && !error && (
          <div ref={containerRef} className="relative h-[70vh] w-full">
            <svg
              ref={svgRef}
              width={dimensions.width}
              height={dimensions.height}
              className="h-full w-full"
            />
            <div
              ref={tooltipRef}
              className="pointer-events-none absolute left-0 top-0 z-10 rounded-lg border border-border bg-background/95 px-3 py-2 text-xs text-foreground shadow-lg opacity-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}
