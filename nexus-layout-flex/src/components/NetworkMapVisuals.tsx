import React from "react";

import { splitQuadraticBezier, type Point } from "@/utils/weathermapVisuals";

// Purely presentational pieces shared by pages/ViewNetworkMap.tsx (static)
// and pages/EditNetworkMap.tsx (draggable) — kept free of any interaction
// handlers so each page can wrap them with whatever click/hover/drag
// behavior it needs without duplicating the visual markup.

export const NODE_ICON_SIZE = 100;

// The glyph is /router.svg (public/router.svg, so it's just a plain
// static-asset path, no bundler import needed) rendered as an SVG <image>
// inside the node's <g>. Its colors are baked into the file, so — unlike
// the earlier lucide-icon version — `stroke` only tints the circle badge's
// border, not the glyph itself.
export function RouterNodeIcon({
  radius,
  fill = "#1e293b",
  stroke = "#38bdf8",
  strokeWidth = 2,
}: {
  radius: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  return (
    <>
      {/* <circle r={radius} fill={fill} stroke={stroke} strokeWidth={strokeWidth} /> */}
      <image
        href="/router.svg"
        x={-NODE_ICON_SIZE / 2}
        y={-NODE_ICON_SIZE / 2}
        width={NODE_ICON_SIZE}
        height={NODE_ICON_SIZE}
      />
    </>
  );
}

// The utilization gradient (weathermapVisuals's styleForUtilization) returns
// colors as "rgb(r, g, b)" strings, not hex — stripping only "#" left
// spaces/commas/parens in the id and in the `url(#...)` reference below,
// silently breaking every gradient-colored arrowhead. Strip everything but
// alphanumerics so the id stays a valid, distinct token for any color format.
export const arrowMarkerId = (color: string) => `arrow-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

// One arrowhead <marker> per possible link color (utils/weathermapVisuals's
// ARROW_COLORS) — render this once per <svg>, before any <line> that
// references it via markerEnd. SVG markers can't reliably inherit a
// sibling element's stroke color across browsers, so each color needs its
// own marker definition rather than one marker reused with a dynamic fill.
export function LinkArrowDefs({ colors }: { colors: string[] }) {
  return (
    <defs>
      {colors.map((color) => (
        <marker
          key={color}
          id={arrowMarkerId(color)}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      ))}
    </defs>
  );
}

// Renders a link as two quadratic-Bezier half-curves, source->mid and
// target->mid, each with an arrowhead pointing inward — so the two
// directions of traffic (downlink from one side, uplink from the other)
// visually meet in the middle, right where the throughput labels sit.
// `control` is the link's effective control point — pass the straight-line
// midpoint (utils/weathermapVisuals's effectiveControlPoint) for an
// ordinary straight link, or a dragged bend point to curve it; a control
// point sitting exactly on the straight midpoint is mathematically a
// straight line, so this one code path renders both cases.
// sourceColor/sourceDashed style the source->mid half (the "up"/uplink
// direction — outputBps leaving the source end) and targetColor/targetDashed
// style the target->mid half (the "down"/downlink direction — inputBps
// arriving at the source end), so the two directions of a link can be
// colored independently by utilization instead of sharing one combined value.
export function LinkFlowLine({
  source,
  target,
  control,
  sourceColor,
  targetColor,
  width,
  sourceDashed,
  targetDashed,
  style,
  onMouseMove,
  onMouseLeave,
  onClick,
}: {
  source: Point;
  target: Point;
  control: Point;
  sourceColor: string;
  targetColor: string;
  width: number;
  sourceDashed?: boolean;
  targetDashed?: boolean;
  style?: React.CSSProperties;
  onMouseMove?: React.MouseEventHandler<SVGPathElement>;
  onMouseLeave?: React.MouseEventHandler<SVGPathElement>;
  onClick?: React.MouseEventHandler<SVGPathElement>;
}) {
  const { midpoint, firstControl, secondControl } = splitQuadraticBezier(source, control, target);
  const common = {
    strokeWidth: width,
    strokeLinecap: "round" as const,
    fill: "none" as const,
    opacity: 0.9,
    style,
    onMouseMove,
    onMouseLeave,
    onClick,
  };
  return (
    <>
      <path
        d={`M ${source.x},${source.y} Q ${firstControl.x},${firstControl.y} ${midpoint.x},${midpoint.y}`}
        stroke={sourceColor}
        strokeDasharray={sourceDashed ? "6 6" : undefined}
        markerEnd={`url(#${arrowMarkerId(sourceColor)})`}
        {...common}
      />
      <path
        d={`M ${target.x},${target.y} Q ${secondControl.x},${secondControl.y} ${midpoint.x},${midpoint.y}`}
        stroke={targetColor}
        strokeDasharray={targetDashed ? "6 6" : undefined}
        markerEnd={`url(#${arrowMarkerId(targetColor)})`}
        {...common}
      />
    </>
  );
}

// A solid, high-contrast tag — used both for the downlink/uplink throughput
// labels at a link's midpoint and (via the NodeLabel alias) for a node's
// device-name tag, so both stay legible over any line color, crossing, or
// icon they sit on top of. Colors are set via className rather than
// presentation attributes so the dark: variant applies — a CSS `fill`/
// `stroke` always wins over the attribute, so this flips light-mode
// white-bg/black-border to dark-mode dark-bg/white-border automatically
// with the app's class-based dark mode.
export function LinkLabel({
  x,
  y,
  text,
  fontSize = 9,
}: {
  x: number;
  y: number;
  text: string;
  fontSize?: number;
}) {
  const approxWidth = text.length * fontSize * 0.62 + 10;
  const height = fontSize + 8;
  return (
    <g transform={`translate(${x},${y})`} style={{ pointerEvents: "none" }}>
      <rect
        x={-approxWidth / 2}
        y={-height / 2}
        width={approxWidth}
        height={height}
        rx={4}
        strokeWidth={1}
        className="fill-white stroke-black dark:fill-slate-900 dark:stroke-white"
      />
      <text
        textAnchor="middle"
        dy={fontSize / 3}
        fontSize={fontSize}
        className="fill-black dark:fill-white"
      >
        {text}
      </text>
    </g>
  );
}

export const NodeLabel = LinkLabel;

// Draggable handle shown on the selected link in the editor — dragging it
// sets/moves the link's bend point; it always renders at the link's
// current effective control point (see effectiveControlPoint), so it
// starts right on the straight line before the admin has bent anything.
export function BendHandle({
  x,
  y,
  bindDrag,
}: {
  x: number;
  y: number;
  bindDrag: (el: SVGCircleElement | null) => void;
}) {
  return (
    <circle
      ref={bindDrag}
      cx={x}
      cy={y}
      r={6}
      fill="#eab308"
      stroke="#fff"
      strokeWidth={1.5}
      style={{ cursor: "grab" }}
    />
  );
}
