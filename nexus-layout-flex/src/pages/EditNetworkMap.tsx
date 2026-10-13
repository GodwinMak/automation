import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import * as d3 from "d3";
import { useNavigate, useParams } from "react-router-dom";
import { PRODUCTION_URL as API_URL } from "@/utils/Api";
import { useZoomPan } from "@/hooks/useZoomPan";
import {
  directionalEdgeStyle,
  edgeWidth,
  formatUpLabel,
  formatDownLabel,
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
  BendHandle,
} from "@/components/NetworkMapVisuals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Save,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Cable,
  LayoutGrid,
  X,
  Search,
  Spline,
  ArrowLeftRight,
} from "lucide-react";

const NODE_RADIUS = 24;
const CANVAS_WIDTH = 4000;
const CANVAS_HEIGHT = 2600;
const ROW_HEIGHT = 160;

type Tier = "INTERNATIONAL" | "P" | "PE" | "BNG" | "AGG" | "ACC" | "OTHER";
const TIER_ROWS: { key: string; label: string; tiers: Tier[] }[] = [
  { key: "INTERNATIONAL", label: "International", tiers: ["INTERNATIONAL"] },
  { key: "P", label: "Core (P)", tiers: ["P"] },
  { key: "PE_BNG", label: "PE / BNG", tiers: ["PE", "BNG"] },
  { key: "AGG", label: "Aggregation", tiers: ["AGG"] },
  { key: "ACC", label: "Access", tiers: ["ACC"] },
  { key: "OTHER", label: "Other", tiers: ["OTHER"] },
];

type EditorNode = { deviceName: string; x: number; y: number };
type EditorLink = {
  sourceDeviceName: string;
  targetDeviceName: string;
  sourceInterface: string | null;
  targetInterface: string | null;
  capacityMbps: number | null;
  bendX: number | null;
  bendY: number | null;
};
type LiveNode = { id: string; tier: Tier };
type LiveLink = {
  source: string;
  target: string;
  sourceInterface: string | null;
  targetInterface: string | null;
  state: string;
  portSpeedMbps: number | null;
  inputBps: number | string | null;
  outputBps: number | string | null;
  utilizationPercent: number | null;
};

const linkKey = (l: { sourceDeviceName?: string; targetDeviceName?: string; source?: string; target?: string; sourceInterface: string | null; targetInterface: string | null }) => {
  const a = l.sourceDeviceName ?? l.source ?? "";
  const b = l.targetDeviceName ?? l.target ?? "";
  const pair = [a, b].sort();
  const ifaces = [l.sourceInterface || "", l.targetInterface || ""].sort();
  return `${pair.join("|")}::${ifaces.join("|")}`;
};

const EditNetworkMap = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const hasAutoFitRef = useRef(false);

  const { svgRef, groupRef, containerRef, viewport, viewportReady, fitToScreen, zoomBy } = useZoomPan();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [links, setLinks] = useState<EditorLink[]>([]);
  const [liveNodes, setLiveNodes] = useState<LiveNode[]>([]);
  const [liveLinks, setLiveLinks] = useState<LiveLink[]>([]);

  const [search, setSearch] = useState("");
  const [connectMode, setConnectMode] = useState(false);
  const [pendingConnectFrom, setPendingConnectFrom] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedLinkKey, setSelectedLinkKey] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      axios.get(`${API_URL}/network-maps/${id}`),
      axios.get(`${API_URL}/weathermap/topology`),
    ])
      .then(([mapRes, topoRes]) => {
        setName(mapRes.data.name);
        setDescription(mapRes.data.description || "");
        setNodes(mapRes.data.nodes.map((n: any) => ({ deviceName: n.deviceName, x: n.x, y: n.y })));
        setLinks(
          mapRes.data.links.map((l: any) => ({
            sourceDeviceName: l.sourceDeviceName,
            targetDeviceName: l.targetDeviceName,
            sourceInterface: l.sourceInterface,
            targetInterface: l.targetInterface,
            capacityMbps: l.capacityMbps ?? null,
            bendX: l.bendX ?? null,
            bendY: l.bendY ?? null,
          }))
        );
        setLiveNodes(topoRes.data.nodes || []);
        setLiveLinks(topoRes.data.links || []);
      })
      .catch((err) => {
        console.error("Error loading editor data:", err);
        toast({ title: "Failed to load map editor", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, [id]);

  const liveTierByName = useMemo(() => new Map(liveNodes.map((n) => [n.id, n.tier])), [liveNodes]);
  const placedNames = useMemo(() => new Set(nodes.map((n) => n.deviceName)), [nodes]);

  const selectedLink = useMemo(
    () => links.find((l) => linkKey(l) === selectedLinkKey) || null,
    [links, selectedLinkKey]
  );

  // Multiple physical links between the same two devices otherwise render
  // exactly on top of each other (identical endpoint coordinates) — offset
  // them sideways so every one of them is visible. A link with its own
  // saved bend point already diverges from its parallel siblings on its
  // own, so it skips the artificial offset and uses its real position.
  const linksWithGeometry = useMemo(() => {
    const withOffsets = withParallelOffsets(links, (l) =>
      [l.sourceDeviceName, l.targetDeviceName].sort().join("|")
    );
    return withOffsets
      .map(({ link, offset }) => {
        const rawSource = nodes.find((n) => n.deviceName === link.sourceDeviceName);
        const rawTarget = nodes.find((n) => n.deviceName === link.targetDeviceName);
        if (!rawSource || !rawTarget) return null;

        const hasBend = link.bendX != null && link.bendY != null;
        if (hasBend) {
          return {
            link,
            source: rawSource,
            target: rawTarget,
            control: { x: link.bendX as number, y: link.bendY as number },
          };
        }
        const { source, target } = offsetSegment(rawSource, rawTarget, offset);
        return { link, source, target, control: effectiveControlPoint(source, target, null) };
      })
      .filter((v): v is { link: EditorLink; source: Point; target: Point; control: Point } => v !== null);
  }, [links, nodes]);

  const selectedGeometry = useMemo(
    () => (selectedLinkKey ? linksWithGeometry.find((g) => linkKey(g.link) === selectedLinkKey) || null : null),
    [linksWithGeometry, selectedLinkKey]
  );

  const setBendForSelected = (x: number, y: number) => {
    if (!selectedLinkKey) return;
    setLinks((prev) =>
      prev.map((l) => (linkKey(l) === selectedLinkKey ? { ...l, bendX: x, bendY: y } : l))
    );
  };

  const straightenSelected = () => {
    if (!selectedLinkKey) return;
    setLinks((prev) =>
      prev.map((l) => (linkKey(l) === selectedLinkKey ? { ...l, bendX: null, bendY: null } : l))
    );
  };

  const setCapacityForSelected = (value: number | null) => {
    if (!selectedLinkKey) return;
    setLinks((prev) =>
      prev.map((l) => (linkKey(l) === selectedLinkKey ? { ...l, capacityMbps: value } : l))
    );
  };

  // Same event.x/event.y-is-pre-zoom-compensated assumption as bindDrag
  // below — the handle lives inside the same zoomed <g>.
  const bindBendDrag = (el: SVGCircleElement | null) => {
    if (!el) return;
    d3.select(el).call(
      d3.drag<SVGCircleElement, unknown>().on("drag", (event) => setBendForSelected(event.x, event.y))
    );
  };

  const availableNodes = useMemo(() => {
    const q = search.trim().toUpperCase();
    return liveNodes
      .filter((n) => !placedNames.has(n.id))
      .filter((n) => !q || n.id.toUpperCase().includes(q))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [liveNodes, placedNames, search]);

  const availableByTierRow = useMemo(() => {
    const tierToRow = new Map<Tier, string>();
    TIER_ROWS.forEach((r) => r.tiers.forEach((t) => tierToRow.set(t, r.key)));
    const grouped = new Map<string, LiveNode[]>();
    availableNodes.forEach((n) => {
      const rowKey = tierToRow.get(n.tier) || "OTHER";
      if (!grouped.has(rowKey)) grouped.set(rowKey, []);
      grouped.get(rowKey)!.push(n);
    });
    return TIER_ROWS.filter((r) => grouped.has(r.key)).map((r) => ({
      ...r,
      nodes: grouped.get(r.key)!,
    }));
  }, [availableNodes]);

  const { placedWidth, placedHeight } = useMemo(() => {
    if (nodes.length === 0) return { placedWidth: 0, placedHeight: 0 };
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    return {
      placedWidth: Math.max(...xs) - Math.min(...xs) + 200,
      placedHeight: Math.max(...ys) - Math.min(...ys) + 200,
    };
  }, [nodes]);

  useEffect(() => {
    if (hasAutoFitRef.current || nodes.length === 0 || !viewportReady) return;
    fitToScreen(placedWidth, placedHeight, false);
    hasAutoFitRef.current = true;
  }, [nodes.length, placedWidth, placedHeight, fitToScreen, viewportReady]);

  const addNode = (deviceName: string) => {
    const centerX = nodes.length
      ? nodes.reduce((s, n) => s + n.x, 0) / nodes.length
      : CANVAS_WIDTH / 2;
    const centerY = nodes.length
      ? nodes.reduce((s, n) => s + n.y, 0) / nodes.length
      : CANVAS_HEIGHT / 2;
    const jitter = () => (Math.random() - 0.5) * 160;
    setNodes((prev) => [...prev, { deviceName, x: centerX + jitter(), y: centerY + jitter() }]);
  };

  const removeNode = (deviceName: string) => {
    setNodes((prev) => prev.filter((n) => n.deviceName !== deviceName));
    setLinks((prev) =>
      prev.filter((l) => l.sourceDeviceName !== deviceName && l.targetDeviceName !== deviceName)
    );
    if (pendingConnectFrom === deviceName) setPendingConnectFrom(null);
  };

  const updateNodePosition = (deviceName: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.deviceName === deviceName ? { ...n, x, y } : n)));
  };

  const handleNodeClick = (deviceName: string) => {
    if (!connectMode) return;
    if (!pendingConnectFrom) {
      setPendingConnectFrom(deviceName);
      return;
    }
    if (pendingConnectFrom === deviceName) {
      setPendingConnectFrom(null);
      return;
    }

    const matches = liveLinks.filter(
      (e) =>
        (e.source === pendingConnectFrom && e.target === deviceName) ||
        (e.source === deviceName && e.target === pendingConnectFrom)
    );

    if (matches.length === 0) {
      toast({
        title: "No live link found",
        description: `No discovered physical link between ${pendingConnectFrom} and ${deviceName}.`,
        variant: "destructive",
      });
      setPendingConnectFrom(null);
      return;
    }

    setLinks((prev) => {
      const existingKeys = new Set(prev.map(linkKey));
      const additions = matches
        .filter((m) => !existingKeys.has(linkKey(m)))
        .map((m) => ({
          sourceDeviceName: m.source,
          targetDeviceName: m.target,
          sourceInterface: m.sourceInterface,
          targetInterface: m.targetInterface,
          capacityMbps: null,
          bendX: null,
          bendY: null,
        }));
      if (additions.length === 0) {
        toast({ title: "Already connected", description: "That link is already on this map." });
        return prev;
      }
      toast({
        title: `Added ${additions.length} link${additions.length > 1 ? "s" : ""}`,
        description: `${pendingConnectFrom} ↔ ${deviceName}`,
      });
      return [...prev, ...additions];
    });
    setPendingConnectFrom(null);
  };

  const removeSelectedLink = () => {
    if (!selectedLinkKey) return;
    setLinks((prev) => prev.filter((l) => linkKey(l) !== selectedLinkKey));
    setSelectedLinkKey(null);
  };

  // Swaps which device this link calls "source" vs "target" — the viewer
  // labels In/Out and colors the two line halves relative to source's own
  // traffic counters (see ViewNetworkMap.tsx), so a link drawn by clicking
  // the "wrong" node first shows traffic flowing backwards. linkKey sorts
  // the pair alphabetically regardless of source/target order, so the
  // selection survives the swap with no extra bookkeeping.
  const reverseSelectedLink = () => {
    if (!selectedLinkKey) return;
    setLinks((prev) =>
      prev.map((l) =>
        linkKey(l) === selectedLinkKey
          ? {
              ...l,
              sourceDeviceName: l.targetDeviceName,
              targetDeviceName: l.sourceDeviceName,
              sourceInterface: l.targetInterface,
              targetInterface: l.sourceInterface,
            }
          : l
      )
    );
  };

  const autoArrange = () => {
    const tierToRow = new Map<Tier, string>();
    TIER_ROWS.forEach((r) => r.tiers.forEach((t) => tierToRow.set(t, r.key)));

    const byRow = new Map<string, string[]>();
    nodes.forEach((n) => {
      const tier = liveTierByName.get(n.deviceName) || "OTHER";
      const rowKey = tierToRow.get(tier as Tier) || "OTHER";
      if (!byRow.has(rowKey)) byRow.set(rowKey, []);
      byRow.get(rowKey)!.push(n.deviceName);
    });

    const activeRows = TIER_ROWS.filter((r) => byRow.has(r.key));
    const nextNodes: EditorNode[] = [];
    activeRows.forEach((row, rowIndex) => {
      const names = byRow.get(row.key)!;
      const y = 100 + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const scale = d3
        .scalePoint<number>()
        .domain(names.map((_, i) => i))
        .range([150, Math.max(600, names.length * 130)])
        .padding(0.5);
      names.forEach((deviceName, i) => {
        nextNodes.push({ deviceName, x: scale(i) || 0, y });
      });
    });
    setNodes(nextNodes);
    toast({ title: "Arranged by tier", description: "Drag any node to fine-tune." });
  };

  // d3.drag reads pointer position relative to the dragged element's
  // parent, which already sits inside groupRef's zoom/pan transform — so
  // event.x/event.y come back pre-compensated for the current zoom level,
  // the same assumption the retired Topology.tsx's force-view drag relied on.
  const bindDrag = (node: SVGGElement | null, deviceName: string) => {
    if (!node) return;
    d3.select(node).call(
      d3
        .drag<SVGGElement, unknown>()
        .on("drag", (event) => updateNodePosition(deviceName, event.x, event.y))
    );
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await axios.put(`${API_URL}/network-maps/${id}`, {
        name,
        description,
        nodes,
        links,
      });
      toast({ title: "Map saved" });
      navigate(`/network-maps/${id}`);
    } catch (err) {
      console.error("Error saving network map:", err);
      toast({ title: "Failed to save map", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const liveLinkFor = (l: EditorLink) => {
    const key = linkKey(l);
    return liveLinks.find((e) => linkKey(e) === key);
  };

  // The utilization gradient produces a continuously varying color per
  // link/direction rather than a handful of fixed bands, so the arrowhead
  // <marker> defs (LinkArrowDefs) can't be pre-rendered from a static
  // palette — collect the actual colors this render will draw instead.
  const arrowColors = useMemo(() => {
    const colors = new Set<string>(FIXED_ARROW_COLORS);
    linksWithGeometry.forEach(({ link: l }) => {
      const key = linkKey(l);
      const live = liveLinks.find((e) => linkKey(e) === key);
      const speed = l.capacityMbps ?? live?.portSpeedMbps;
      const isDown = live ? live.state === "Down" : true;
      colors.add(live ? directionalEdgeStyle(live.outputBps, speed, isDown).color : "#94a3b8");
      colors.add(live ? directionalEdgeStyle(live.inputBps, speed, isDown).color : "#94a3b8");
    });
    return Array.from(colors);
  }, [linksWithGeometry, liveLinks]);

  // Rendered as a standalone route (outside <Layout />, see App.tsx) — no
  // dashboard sidebar/header, so this page reproduces Layout's own
  // background/padding itself rather than losing it.
  if (loading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gradient-subtle text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading editor...
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col gap-4 bg-gradient-subtle px-4 py-6 lg:px-6">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <Label htmlFor="edit-map-name">Map name</Label>
          <Input
            id="edit-map-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-sm text-lg font-semibold"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="max-w-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate(`/network-maps/${id}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 rounded-xl border border-border bg-card px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={connectMode ? "default" : "outline"}
            onClick={() => {
              setConnectMode((v) => !v);
              setPendingConnectFrom(null);
            }}
          >
            <Cable className="mr-2 h-4 w-4" />
            {connectMode ? "Connecting… (click two nodes)" : "Connect Nodes"}
          </Button>
          <Button size="sm" variant="outline" onClick={autoArrange} disabled={nodes.length === 0}>
            <LayoutGrid className="mr-2 h-4 w-4" />
            Auto-arrange by tier
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {nodes.length} nodes · {links.length} links
          </span>
        </div>

        {selectedLink && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <span className="text-xs font-medium text-foreground">
              {selectedLink.sourceDeviceName} → {selectedLink.targetDeviceName}
            </span>
            <span className="text-xs text-muted-foreground">
              (In/Out measured from {selectedLink.sourceDeviceName}'s side — Reverse if backwards)
            </span>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="link-capacity" className="text-xs text-muted-foreground">
                Capacity (Mbps)
              </Label>
              <Input
                id="link-capacity"
                type="number"
                min={0}
                placeholder="auto"
                value={selectedLink.capacityMbps ?? ""}
                onChange={(e) =>
                  setCapacityForSelected(e.target.value === "" ? null : Number(e.target.value))
                }
                className="h-8 w-28"
              />
            </div>
            <Button size="sm" variant="outline" onClick={reverseSelectedLink}>
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Reverse direction
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={straightenSelected}
              disabled={selectedLink.bendX == null}
            >
              <Spline className="mr-2 h-4 w-4" />
              Straighten
            </Button>
            <Button size="sm" variant="destructive" onClick={removeSelectedLink}>
              <X className="mr-2 h-4 w-4" />
              Remove link
            </Button>
            <span className="text-xs text-muted-foreground">Drag the yellow handle on the link to bend it.</span>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex w-64 shrink-0 flex-col space-y-2 rounded-xl border border-border bg-card p-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search devices..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {availableByTierRow.map((row) => (
              <div key={row.key}>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">{row.label}</p>
                <div className="space-y-1">
                  {row.nodes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => addNode(n.id)}
                      className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-foreground transition hover:bg-accent"
                      title={n.id}
                    >
                      {n.id}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {availableByTierRow.length === 0 && (
              <p className="px-1 text-xs text-muted-foreground">No matching devices.</p>
            )}
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
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
              onClick={() => fitToScreen(placedWidth, placedHeight, true)}
              className="rounded-md p-1.5 text-foreground transition hover:bg-accent"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>

          <div ref={containerRef} className="relative h-full w-full overflow-hidden">
            {nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Click a device on the left to add it to the map.
              </div>
            ) : (
              <svg
                ref={svgRef}
                width={viewport.width}
                height={viewport.height}
                className={connectMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}
              >
                <g ref={groupRef}>
                  <LinkArrowDefs colors={arrowColors} />
                  {linksWithGeometry.map(({ link: l, source, target, control }) => {
                    const key = linkKey(l);
                    const live = liveLinkFor(l);
                    const selected = selectedLinkKey === key;
                    const speed = l.capacityMbps ?? live?.portSpeedMbps;
                    const isDown = live ? live.state === "Down" : true;
                    const upStyle = live
                      ? directionalEdgeStyle(live.outputBps, speed, isDown)
                      : { color: "#94a3b8", dashed: true };
                    const downStyle = live
                      ? directionalEdgeStyle(live.inputBps, speed, isDown)
                      : { color: "#94a3b8", dashed: true };
                    return (
                      <LinkFlowLine
                        key={key}
                        source={source}
                        target={target}
                        control={control}
                        sourceColor={selected ? "#eab308" : upStyle.color}
                        targetColor={selected ? "#eab308" : downStyle.color}
                        width={selected ? 5 : edgeWidth(speed)}
                        sourceDashed={!selected && upStyle.dashed}
                        targetDashed={!selected && downStyle.dashed}
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLinkKey((prev) => (prev === key ? null : key));
                        }}
                      />
                    );
                  })}

                  {linksWithGeometry.map(({ link: l, source, target, control }) => {
                    const live = liveLinkFor(l);
                    if (!live) return null;
                    const up = formatUpLabel(live.outputBps);
                    const down = formatDownLabel(live.inputBps);
                    return (
                      <React.Fragment key={`labels-${linkKey(l)}`}>
                        {up && <LinkLabel {...quadraticPointAt(source, control, target, 0.3)} text={up} />}
                        {down && <LinkLabel {...quadraticPointAt(source, control, target, 0.7)} text={down} />}
                      </React.Fragment>
                    );
                  })}

                  {selectedGeometry && (
                    <BendHandle
                      x={selectedGeometry.control.x}
                      y={selectedGeometry.control.y}
                      bindDrag={bindBendDrag}
                    />
                  )}

                  {nodes.map((node) => (
                    <g
                      key={node.deviceName}
                      ref={(el) => bindDrag(el, node.deviceName)}
                      transform={`translate(${node.x},${node.y})`}
                      onMouseEnter={() => setHoveredNode(node.deviceName)}
                      onMouseLeave={() => setHoveredNode((prev) => (prev === node.deviceName ? null : prev))}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNodeClick(node.deviceName);
                      }}
                      style={{ cursor: connectMode ? "crosshair" : "grab" }}
                    >
                      <RouterNodeIcon
                        radius={NODE_RADIUS}
                        stroke={pendingConnectFrom === node.deviceName ? "#eab308" : "#38bdf8"}
                        strokeWidth={pendingConnectFrom === node.deviceName ? 4 : 2}
                      />
                      <NodeLabel x={0} y={0} text={node.deviceName} fontSize={11} />
                      {hoveredNode === node.deviceName && !connectMode && (
                        <g
                          transform={`translate(${NODE_RADIUS - 2},${-NODE_RADIUS + 2})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeNode(node.deviceName);
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <circle r={8} fill="#ef4444" />
                          <text
                            textAnchor="middle"
                            dy={3}
                            fontSize={11}
                            fill="#fff"
                            style={{ pointerEvents: "none" }}
                          >
                            ×
                          </text>
                        </g>
                      )}
                    </g>
                  ))}
                </g>
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditNetworkMap;
