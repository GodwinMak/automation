// Shared rendering helpers for both the read-only network map viewer
// (pages/ViewNetworkMap.tsx) and the admin editor (pages/EditNetworkMap.tsx)
// — ported from the retired auto-tiered pages/Weathermap.tsx so this
// already-proven color/width/formatting logic isn't duplicated.
import * as d3 from "d3";

export type LiveLinkState = "Up" | "Down" | string;

export type LiveLinkStyleInput = {
  state: LiveLinkState;
  utilizationPercent: number | null;
};

export type Point = { x: number; y: number };

// Compact LibreNMS-style unit suffix — "12.3M", "8.1G", "450K" — no space,
// no "bps".
export const formatBps = (value: number | string | null | undefined) => {
  if (value == null) return null;
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n) || n <= 0) return "0";
  const units = ["", "K", "M", "G"];
  let unitIndex = 0;
  let scaled = n;
  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }
  return `${scaled.toFixed(scaled >= 100 ? 0 : 1)}${units[unitIndex]}`;
};

// The "up" (output — traffic leaving the source end) and "down" (input —
// traffic arriving at the source end) labels are rendered as two separate
// labels, one on each half-arrow of a link (see LinkFlowLine), rather than
// combined into one string — each sits next to the arrow whose direction
// it actually describes.
export const formatUpLabel = (outputBps: number | string | null | undefined) => {
  const v = formatBps(outputBps);
  return v ? `↑${v}` : null;
};
export const formatDownLabel = (inputBps: number | string | null | undefined) => {
  const v = formatBps(inputBps);
  return v ? `↓${v}` : null;
};

// Anchor points for the utilization color ramp — exposed so the legend can
// render the exact same blue -> green -> yellow -> orange -> red gradient as
// a CSS `linear-gradient` instead of discrete swatches.
export const UTILIZATION_GRADIENT_STOPS: { pct: number; color: string }[] = [
  { pct: 0, color: "#3b82f6" },
  { pct: 25, color: "#22c55e" },
  { pct: 50, color: "#facc15" },
  { pct: 75, color: "#f97316" },
  { pct: 100, color: "#ef4444" },
];

// d3's continuous scales interpolate piecewise between every domain/range
// pair (not just the first and last), so this walks smoothly through all
// five anchor colors above rather than jumping between fixed bands.
const utilizationColorScale = d3
  .scaleLinear<string>()
  .domain(UTILIZATION_GRADIENT_STOPS.map((s) => s.pct))
  .range(UTILIZATION_GRADIENT_STOPS.map((s) => s.color))
  .clamp(true);

// Color/dash for one utilization value — shared by the whole-link edgeStyle
// below and by directionalEdgeStyle, which calls this once per traffic
// direction so the uplink and downlink halves of a link (see LinkFlowLine)
// can be colored independently instead of sharing one combined value.
export const styleForUtilization = (utilizationPercent: number | null, isDown: boolean) => {
  if (isDown) {
    return { color: "#a855f7", dashed: true };
  }
  if (utilizationPercent == null) {
    return { color: "#94a3b8", dashed: true };
  }
  return { color: utilizationColorScale(utilizationPercent), dashed: false };
};

export const edgeStyle = (link: LiveLinkStyleInput) =>
  styleForUtilization(link.utilizationPercent, link.state === "Down");

// Utilization of a single traffic direction (as opposed to the combined
// max(in,out) the backend's utilizationPercent represents) — outputBps vs
// portSpeedMbps for the uplink half, inputBps vs portSpeedMbps for the
// downlink half.
export const directionalUtilization = (
  bps: number | string | null | undefined,
  portSpeedMbps: number | null | undefined
): number | null => {
  if (!portSpeedMbps || bps == null) return null;
  const n = typeof bps === "string" ? parseFloat(bps) : bps;
  if (!Number.isFinite(n)) return null;
  return (n / 1e6 / portSpeedMbps) * 100;
};

export const directionalEdgeStyle = (
  bps: number | string | null | undefined,
  portSpeedMbps: number | null | undefined,
  isDown: boolean
) => styleForUtilization(directionalUtilization(bps, portSpeedMbps), isDown);

const widthScale = d3.scaleLog().domain([10, 100000]).range([1.5, 8]).clamp(true);

export const edgeWidth = (portSpeedMbps: number | null | undefined) =>
  portSpeedMbps ? widthScale(portSpeedMbps) : 1.5;

// The fixed (non-gradient) colors edgeStyle/styleForUtilization can return
// — "Down" and "no data" — plus the editor's "selected link" highlight
// (#eab308). The utilization gradient itself produces a continuously
// varying color per link, so callers must additionally collect the actual
// per-link colors in use (see each page's `arrowColors` memo) and pass the
// combined list to LinkArrowDefs, since SVG markers can't dynamically
// inherit a sibling line's stroke color reliably across browsers — every
// color actually drawn needs its own pre-rendered <marker>.
export const FIXED_ARROW_COLORS = ["#a855f7", "#94a3b8", "#eab308"];

// Point a given fraction of the way from a to b (0 = a, 1 = b, 0.5 = midpoint).
export const pointAt = (a: Point, b: Point, fraction: number): Point => ({
  x: a.x + (b.x - a.x) * fraction,
  y: a.y + (b.y - a.y) * fraction,
});

// Shifts both endpoints of a segment sideways (perpendicular to its own
// direction) by `offset` pixels — used to fan out multiple parallel
// physical links between the same two devices, which would otherwise
// render as one line since they share identical endpoint coordinates.
export const offsetSegment = (source: Point, target: Point, offset: number) => {
  if (!offset) return { source, target };
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  return {
    source: { x: source.x + px * offset, y: source.y + py * offset },
    target: { x: target.x + px * offset, y: target.y + py * offset },
  };
};

// A quadratic Bezier whose control point sits exactly on the segment's own
// midpoint is mathematically identical to a straight line — so "no bend
// set" and "bend point == straight midpoint" are the same curve. That lets
// every link (bent or not) be treated as one quadratic Bezier through an
// "effective" control point, instead of needing separate straight/curved
// render paths.
export const effectiveControlPoint = (source: Point, target: Point, bend: Point | null): Point =>
  bend ?? pointAt(source, target, 0.5);

export const quadraticPointAt = (p0: Point, control: Point, p2: Point, t: number): Point => {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * control.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * control.y + t * t * p2.y,
  };
};

// Splits one quadratic Bezier (p0 -> control -> p2) into two, meeting
// exactly at its own t=0.5 point (De Casteljau's algorithm) — used to draw
// a bent link as two independent arrow-halves (source->mid, target->mid)
// the same way straight links already are, so the two traffic-direction
// arrows still visually meet in the middle even when the link curves.
export const splitQuadraticBezier = (p0: Point, control: Point, p2: Point) => {
  const q0 = pointAt(p0, control, 0.5);
  const q1 = pointAt(control, p2, 0.5);
  const midpoint = pointAt(q0, q1, 0.5);
  return { midpoint, firstControl: q0, secondControl: q1 };
};

// Assigns each link in a group sharing the same (unordered) device pair its
// own perpendicular offset, spread evenly around 0, so node-to-node pairs
// with more than one physical link all render as distinct, visible lines
// instead of stacking exactly on top of each other.
export const withParallelOffsets = <T,>(
  links: T[],
  pairKeyOf: (link: T) => string,
  spacing = 16
): { link: T; offset: number }[] => {
  const groups = new Map<string, T[]>();
  links.forEach((l) => {
    const key = pairKeyOf(l);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  });

  const offsetByLink = new Map<T, number>();
  groups.forEach((group) => {
    const n = group.length;
    group.forEach((l, i) => offsetByLink.set(l, (i - (n - 1) / 2) * spacing));
  });

  return links.map((link) => ({ link, offset: offsetByLink.get(link) ?? 0 }));
};
