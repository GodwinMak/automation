import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { PRODUCTION_URL as API_URL } from "@/utils/Api";
import { useZoomPan } from "@/hooks/useZoomPan";
import {
  formatBps,
  formatUpLabel,
  formatDownLabel,
  directionalEdgeStyle,
  edgeWidth,
  FIXED_ARROW_COLORS,
  quadraticPointAt,
  effectiveControlPoint,
  offsetSegment,
  withParallelOffsets,
  type Point,
} from "@/utils/weathermapVisuals";
import {
  RouterNodeIcon,
  NodeLabel,
  LinkLabel,
  LinkArrowDefs,
  LinkFlowLine,
} from "@/components/NetworkMapVisuals";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { summarizePowerReading, fmtDbm, STATUS_WORD } from "@/utils/opticsPower";

const NODE_RADIUS = 40;
const CANVAS_PADDING = 60;

type MapNode = { id: string; deviceName: string; x: number; y: number };
type LinkEnd = {
  state: string | null;
  portSpeedMbps: number | null;
  inputBps: number | string | null;
  outputBps: number | string | null;
  txPowerDbm: string | null;
  rxPowerDbm: string | null;
  txHighAlarmDbm: number | null;
  txLowAlarmDbm: number | null;
  txHighWarningDbm: number | null;
  txLowWarningDbm: number | null;
  rxHighAlarmDbm: number | null;
  rxLowAlarmDbm: number | null;
  rxHighWarningDbm: number | null;
  rxLowWarningDbm: number | null;
  lastPowerChecked: string | null;
} | null;
type MapLink = {
  id: string;
  sourceDeviceName: string;
  targetDeviceName: string;
  sourceInterface: string | null;
  targetInterface: string | null;
  capacityMbps: number | null;
  bendX: number | null;
  bendY: number | null;
  live: boolean;
  state: string | null;
  portSpeedMbps: number | null;
  inputBps: number | string | null;
  outputBps: number | string | null;
  utilizationPercent: number | null;
  sourceEnd: LinkEnd;
  targetEnd: LinkEnd;
};
type MapDetail = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  createdByName: string;
  nodes: MapNode[];
  links: MapLink[];
};

type TooltipData = { title: string; subtitle?: string; meta?: string[] };

const ViewNetworkMap = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hasAutoFitRef = useRef(false);

  const [map, setMap] = useState<MapDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { svgRef, groupRef, containerRef, viewport, viewportReady, fitToScreen, zoomBy } = useZoomPan();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    axios
      .get(`${API_URL}/network-maps/${id}`)
      .then((res) => setMap(res.data))
      .catch((err) => {
        console.error("Error loading network map:", err);
        setError("Failed to load this map.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const { positionedNodes, canvasWidth, canvasHeight, toCanvas } = useMemo(() => {
    if (!map || map.nodes.length === 0) {
      return {
        positionedNodes: [] as MapNode[],
        canvasWidth: 0,
        canvasHeight: 0,
        toCanvas: (p: Point) => p,
      };
    }
    const xs = map.nodes.map((n) => n.x);
    const ys = map.nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    // bend points are saved in the same raw coordinate space node x/y were
    // saved in — shift them by the same amount so a curve still lines up
    // with its (also-shifted) endpoints.
    const toCanvas = (p: Point): Point => ({
      x: p.x - minX + CANVAS_PADDING,
      y: p.y - minY + CANVAS_PADDING,
    });

    const positioned = map.nodes.map((n) => ({ ...n, ...toCanvas(n) }));

    return {
      positionedNodes: positioned,
      canvasWidth: maxX - minX + CANVAS_PADDING * 2,
      canvasHeight: maxY - minY + CANVAS_PADDING * 2,
      toCanvas,
    };
  }, [map]);

  const nodeByName = useMemo(
    () => new Map(positionedNodes.map((n) => [n.deviceName, n])),
    [positionedNodes]
  );

  // Multiple physical links between the same two devices otherwise render
  // exactly on top of each other (identical endpoint coordinates) — offset
  // them sideways so every one of them is visible. A link with its own
  // saved bend point already diverges from its parallel siblings on its
  // own, so it skips the artificial offset and uses its real position.
  const linksWithGeometry = useMemo(() => {
    const withOffsets = withParallelOffsets(map?.links || [], (l) =>
      [l.sourceDeviceName, l.targetDeviceName].sort().join("|")
    );
    return withOffsets
      .map(({ link, offset }) => {
        const rawSource = nodeByName.get(link.sourceDeviceName);
        const rawTarget = nodeByName.get(link.targetDeviceName);
        if (!rawSource || !rawTarget) return null;

        const hasBend = link.bendX != null && link.bendY != null;
        if (hasBend) {
          return {
            link,
            source: rawSource,
            target: rawTarget,
            control: toCanvas({ x: link.bendX as number, y: link.bendY as number }),
          };
        }
        const { source, target } = offsetSegment(rawSource, rawTarget, offset);
        return { link, source, target, control: effectiveControlPoint(source, target, null) };
      })
      .filter((v): v is { link: MapLink; source: Point; target: Point; control: Point } => v !== null);
  }, [map, nodeByName, toCanvas]);

  // The utilization gradient produces a continuously varying color per
  // link/direction rather than a handful of fixed bands, so the arrowhead
  // <marker> defs (LinkArrowDefs) can't be pre-rendered from a static
  // palette — collect the actual colors this render will draw instead.
  const arrowColors = useMemo(() => {
    const colors = new Set<string>(FIXED_ARROW_COLORS);
    linksWithGeometry.forEach(({ link }) => {
      const isDown = !link.live || link.state === "Down";
      const speed = link.capacityMbps ?? link.portSpeedMbps;
      colors.add(directionalEdgeStyle(link.outputBps, speed, isDown).color);
      colors.add(directionalEdgeStyle(link.inputBps, speed, isDown).color);
    });
    return Array.from(colors);
  }, [linksWithGeometry]);

  useEffect(() => {
    if (hasAutoFitRef.current || positionedNodes.length === 0 || !viewportReady) return;
    fitToScreen(canvasWidth, canvasHeight, false);
    hasAutoFitRef.current = true;
  }, [positionedNodes.length, canvasWidth, canvasHeight, fitToScreen, viewportReady]);

  // One line per lane group ("Tx"/"Rx"), showing the worst lane's reading
  // and status against its own alarm/warning bounds — a 4-lane 100G port
  // collapses to its single worst-offending lane rather than 8 separate
  // lines, since that's the one that actually needs attention.
  const powerLinesForEnd = (deviceName: string, end: LinkEnd): string[] => {
    if (!end) return [];
    const tx = summarizePowerReading(
      end.txPowerDbm, end.txHighAlarmDbm, end.txLowAlarmDbm, end.txHighWarningDbm, end.txLowWarningDbm
    );
    const rx = summarizePowerReading(
      end.rxPowerDbm, end.rxHighAlarmDbm, end.rxLowAlarmDbm, end.rxHighWarningDbm, end.rxLowWarningDbm
    );
    if (tx.status === "nodata" && rx.status === "nodata") return [];
    const lines: string[] = [];
    if (tx.status !== "nodata") lines.push(`${deviceName} Tx: ${fmtDbm(tx.worstValue)} dBm (${STATUS_WORD[tx.status]})`);
    if (rx.status !== "nodata") lines.push(`${deviceName} Rx: ${fmtDbm(rx.worstValue)} dBm (${STATUS_WORD[rx.status]})`);
    return lines;
  };

  const showTooltip = (event: React.MouseEvent, tooltip: TooltipData) => {
    const el = tooltipRef.current;
    if (!el) return;
    el.style.opacity = "1";
    el.style.left = `${event.clientX + 16}px`;
    el.style.top = `${event.clientY + 16}px`;
    el.innerHTML = `
      <div class="text-xs font-semibold text-foreground">${tooltip.title}</div>
      ${tooltip.subtitle ? `<div class="text-[11px] text-muted-foreground">${tooltip.subtitle}</div>` : ""}
      ${(tooltip.meta || []).map((m) => `<div class="text-[11px] text-muted-foreground">${m}</div>`).join("")}
    `;
  };
  const hideTooltip = () => {
    if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
  };

  // Rendered as a standalone route (outside <Layout />, see App.tsx) — no
  // dashboard sidebar/header, so this page reproduces Layout's own
  // background/padding itself rather than losing it.
  if (loading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gradient-subtle text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading map...
      </div>
    );
  }

  if (error || !map) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-gradient-subtle text-sm text-destructive">
        {error || "Map not found."}
        <Button variant="outline" onClick={() => navigate("/network-maps")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Network Maps
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col gap-4 bg-gradient-subtle px-4 py-6 lg:px-6">
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {map.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            This map has no nodes yet.
          </div>
        ) : (
          <div ref={containerRef} className="relative h-full w-full overflow-hidden">
            <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm">
              <button
                type="button"
                title="Zoom in"
                onClick={() => zoomBy(1.4)}
                className="rounded-md p-1.5 text-foreground transition hover:bg-accent"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Zoom out"
                onClick={() => zoomBy(1 / 1.4)}
                className="rounded-md p-1.5 text-foreground transition hover:bg-accent"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Fit to screen"
                onClick={() => fitToScreen(canvasWidth, canvasHeight, true)}
                className="rounded-md p-1.5 text-foreground transition hover:bg-accent"
              >
                <Maximize className="h-4 w-4" />
              </button>
            </div>

            <svg
              ref={svgRef}
              width={viewport.width}
              height={viewport.height}
              className="cursor-grab active:cursor-grabbing"
            >
              <g ref={groupRef}>
                <LinkArrowDefs colors={arrowColors} />
                {linksWithGeometry.map(({ link, source, target, control }) => {
                  const isDown = !link.live || link.state === "Down";
                  const speed = link.capacityMbps ?? link.portSpeedMbps;
                  const upStyle = directionalEdgeStyle(link.outputBps, speed, isDown);
                  const downStyle = directionalEdgeStyle(link.inputBps, speed, isDown);
                  return (
                    <LinkFlowLine
                      key={link.id}
                      source={source}
                      target={target}
                      control={control}
                      sourceColor={upStyle.color}
                      targetColor={downStyle.color}
                      width={edgeWidth(speed)}
                      sourceDashed={upStyle.dashed}
                      targetDashed={downStyle.dashed}
                      style={{ cursor: "pointer" }}
                      onMouseMove={(e) =>
                        showTooltip(e, {
                          title: `${link.sourceDeviceName} ↔ ${link.targetDeviceName}`,
                          subtitle: `${link.sourceInterface || "?"} ↔ ${link.targetInterface || "?"}`,
                          meta: [
                            !link.live
                              ? "This link is no longer discovered live — showing last-known layout."
                              : `State: ${link.state}`,
                            link.capacityMbps
                              ? `Capacity: ${link.capacityMbps} Mbps (manual)`
                              : link.portSpeedMbps
                              ? `Capacity: ${link.portSpeedMbps} Mbps`
                              : "Capacity: unknown",
                            formatBps(link.inputBps)
                              ? `In (from ${link.targetDeviceName}): ${formatBps(link.inputBps)}`
                              : "",
                            formatBps(link.outputBps)
                              ? `Out (to ${link.targetDeviceName}): ${formatBps(link.outputBps)}`
                              : "",
                            link.utilizationPercent != null
                              ? `Utilization: ${link.utilizationPercent.toFixed(1)}%`
                              : "",
                            ...powerLinesForEnd(link.sourceDeviceName, link.sourceEnd),
                            ...powerLinesForEnd(link.targetDeviceName, link.targetEnd),
                          ].filter(Boolean),
                        })
                      }
                      onMouseLeave={hideTooltip}
                    />
                  );
                })}

                {linksWithGeometry.map(({ link, source, target, control }) => {
                  if (!link.live) return null;
                  const up = formatUpLabel(link.outputBps);
                  const down = formatDownLabel(link.inputBps);
                  return (
                    <React.Fragment key={`labels-${link.id}`}>
                      {up && <LinkLabel {...quadraticPointAt(source, control, target, 0.3)} text={up} />}
                      {down && <LinkLabel {...quadraticPointAt(source, control, target, 0.7)} text={down} />}
                    </React.Fragment>
                  );
                })}

                {positionedNodes.map((node) => (
                  <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    onMouseMove={(e) => showTooltip(e, { title: node.deviceName })}
                    onMouseLeave={hideTooltip}
                  >
                    <RouterNodeIcon radius={NODE_RADIUS} />
                    <NodeLabel x={0} y={0} text={node.deviceName} fontSize={13} />
                  </g>
                ))}
              </g>
            </svg>
            <div
              ref={tooltipRef}
              className="pointer-events-none fixed left-0 top-0 z-10 max-w-xs rounded-lg border border-border bg-background/95 px-3 py-2 text-xs text-foreground shadow-lg opacity-0"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ViewNetworkMap;
