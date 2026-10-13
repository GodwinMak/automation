import { useCallback, useEffect, useRef, useState } from "react";
import * as d3 from "d3";

const ZOOM_EXTENT: [number, number] = [0.15, 5];

// Shared pan/zoom behavior for pages/ViewNetworkMap.tsx and
// pages/EditNetworkMap.tsx — ported from the retired pages/Weathermap.tsx.
// The zoom behavior only ever rewrites groupRef's transform attribute, never
// the <svg>'s own width/height, so the diagram's box on the page stays
// fixed no matter how far the user zooms in or out.
//
// svgRef/groupRef/containerRef below are CALLBACK refs (not plain
// useRef objects) that the caller attaches directly via `ref={svgRef}` etc.
// This is deliberate: the <svg> in both pages only mounts once loading
// finishes (or once the first node is placed), i.e. well after this hook's
// first render. A plain useRef's `.current` doesn't trigger a re-render
// when it's populated later, so an effect keyed on the ref *object*
// (stable identity, never changes) would only ever see it as null and
// never re-run — zoom would silently never attach. Callback refs fire
// exactly when the DOM node mounts/unmounts, so the state they set here
// (svgEl/groupEl) is a reliable effect dependency no matter when — or how
// many times — the underlying element is conditionally mounted.
export function useZoomPan() {
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [groupEl, setGroupEl] = useState<SVGGElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 700 });
  // False until the ResizeObserver below reports the container's real,
  // laid-out size. Callers should wait for this before running a one-time
  // "fit to screen on load" so that fit isn't computed against the
  // {1200,700} placeholder — which would center the diagram against the
  // wrong box and leave it visibly off-center once the real size lands.
  const [viewportReady, setViewportReady] = useState(false);

  const svgRef = useCallback((el: SVGSVGElement | null) => setSvgEl(el), []);
  const groupRef = useCallback((el: SVGGElement | null) => setGroupEl(el), []);
  const containerRef = useCallback((el: HTMLDivElement | null) => setContainerEl(el), []);

  useEffect(() => {
    if (!containerEl) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setViewport({ width, height });
          setViewportReady(true);
        }
      }
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [containerEl]);

  useEffect(() => {
    if (!svgEl || !groupEl) return undefined;

    const svg = d3.select(svgEl);
    const g = d3.select(groupEl);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(ZOOM_EXTENT)
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });

    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    return () => {
      svg.on(".zoom", null);
    };
  }, [svgEl, groupEl]);

  const fitToScreen = useCallback(
    (contentWidth: number, contentHeight: number, animate = true) => {
      const zoom = zoomBehaviorRef.current;
      if (!svgEl || !zoom || contentWidth === 0 || contentHeight === 0) return;

      const scale = Math.min(
        (viewport.width - 24) / contentWidth,
        (viewport.height - 24) / contentHeight,
        1.5
      );
      const clampedScale = Math.max(ZOOM_EXTENT[0], Math.min(ZOOM_EXTENT[1], scale));
      const tx = (viewport.width - contentWidth * clampedScale) / 2;
      const ty = (viewport.height - contentHeight * clampedScale) / 2;
      const transform = d3.zoomIdentity.translate(tx, ty).scale(clampedScale);

      const selection = d3.select(svgEl);
      if (animate) {
        selection.transition().duration(300).call(zoom.transform, transform);
      } else {
        selection.call(zoom.transform, transform);
      }
    },
    [svgEl, viewport.width, viewport.height]
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const zoom = zoomBehaviorRef.current;
      if (!svgEl || !zoom) return;
      d3.select(svgEl).transition().duration(200).call(zoom.scaleBy, factor);
    },
    [svgEl]
  );

  return { svgRef, groupRef, containerRef, viewport, viewportReady, fitToScreen, zoomBy };
}
