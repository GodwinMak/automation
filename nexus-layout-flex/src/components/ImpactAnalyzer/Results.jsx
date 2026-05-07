import React, {useState} from "react";
import { T, SEV_COLORS, SEV_BGS, isAGGNode, isPENode } from "./Constants";
import {fmtBps, trafficUtil, utilColor, ifaceLabel, fmtMetric } from "./formatters"
import {MetricCard, Tag, RecItem,DisruptionBanners, UtilBar } from "./UIElements"
import {AGGReachabilityPanel, CapacityPanel, ParallelSection, PathsPanel, CongestionPanel, IsolationPanel, DownLinksPanel} from "./AnalysisPanels"

export function AnalysisResult({ r, analyzerRef, nodeIPs }) {
  const [activeTab, setActiveTab] = useState("recs");
  const ip = nodeIPs[r.target] || "";
  const aff = r.pathImpact?.reduce((s, p) => s + p.totalAffected, 0) || 0;
  const roleTag =
    !r.linkMode && isAGGNode(r.target) ? (
      <Tag
        color={T.blue}
        bg="rgba(74,158,255,.2)"
        style={{ border: `1px solid rgba(74,158,255,.4)`, marginLeft: 8 }}
      >
        AGG
      </Tag>
    ) : !r.linkMode && isPENode(r.target) ? (
      <Tag
        color={T.purple}
        bg="rgba(155,127,255,.15)"
        style={{ marginLeft: 8 }}
      >
        PE
      </Tag>
    ) : null;
  const tabs = ["recs", "iso", "paths", "cong", "routes", "capacity"];
  const tabLabels = {
    recs: "Recommendations",
    iso: "Isolation",
    paths: "Path Impact",
    cong: "Transit Load",
    routes: "AGG Routes",
    capacity: "Capacity",
  };
  const routesBadge = r.aggReach?.some((s) =>
    s.paths?.some((p) => p.disrupted || p.inflated),
  );
  const capBadge = r.linkCong?.flows?.some(
    (f) => f.risk === "CRITICAL" || f.risk === "HIGH",
  );
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 22,
              fontWeight: 600,
              color: T.blue,
              letterSpacing: ".04em",
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {r.target}
            {r.linkMode && r.parallelCount > 1 && (
              <Tag style={{ marginLeft: 8 }}>{r.parallelCount}× parallel</Tag>
            )}
            {roleTag}
          </div>
          {ip && (
            <div
              style={{
                fontFamily: T.mono,
                fontSize: 12,
                color: T.text3,
                marginTop: 2,
              }}
            >
              {ip}
            </div>
          )}
          {r.maxLvl >= 2 && (
            <Tag
              color={r.maxLvl === 3 ? T.purple : T.amber}
              bg={
                r.maxLvl === 3
                  ? "rgba(155,127,255,.15)"
                  : "rgba(255,179,71,.15)"
              }
              style={{ marginTop: 6 }}
            >
              L{r.maxLvl} backbone
            </Tag>
          )}
          {/* Show live utilisation badge for link failure */}
          {r.linkMode &&
            r.linkTrafficUtil !== null &&
            r.linkTrafficUtil !== undefined && (
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{ fontSize: 11, color: T.text3, fontFamily: T.mono }}
                >
                  LIVE TRAFFIC WHEN FAILED:
                </span>
                <span
                  style={{
                    fontFamily: T.mono,
                    fontSize: 11,
                    color: utilColor(r.linkTrafficUtil),
                    fontWeight: 600,
                  }}
                >
                  {r.linkTrafficUtil}% utilised
                </span>
                <span
                  style={{ fontSize: 11, color: T.text3, fontFamily: T.mono }}
                >
                  ({fmtBps(r.linkInputBps)} ↓ / {fmtBps(r.linkOutputBps)} ↑)
                </span>
              </div>
            )}
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontFamily: T.mono,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".1em",
              background: SEV_BGS[r.severity],
              border: `1px solid ${SEV_COLORS[r.severity]}`,
              color: SEV_COLORS[r.severity],
            }}
          >
            {r.severity}
          </div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 11,
              color: T.text3,
              marginTop: 6,
            }}
          >
            impact score: {r.score}/100
          </div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <MetricCard
          value={r.isolated?.length || 0}
          label="Isolated nodes"
          colorClass={r.isolated?.length > 0 ? "critical" : "ok"}
        />
        <MetricCard
          value={aff}
          label="Paths inflated"
          colorClass={aff > 0 ? "warning" : "ok"}
        />
        <MetricCard
          value={`+${r.maxHopInf || 0}`}
          label="Max hop +"
          colorClass={
            r.maxHopInf >= 3 ? "critical" : r.maxHopInf >= 2 ? "warning" : "ok"
          }
        />
        <MetricCard
          value={r.avgCostInf > 0 ? "+" + fmtMetric(r.avgCostInf) : "0"}
          label="Avg metric +"
          colorClass={
            r.avgCostInf > 50000
              ? "critical"
              : r.avgCostInf > 5000
                ? "warning"
                : "ok"
          }
        />
        <MetricCard
          value={r.degree || "—"}
          label="Neighbors"
          colorClass="info"
        />
        {!r.linkMode && r.edgeCount && r.edgeCount > r.degree && (
          <MetricCard
            value={r.edgeCount}
            label="Interfaces"
            colorClass="info"
          />
        )}
        {r.linkMode && (
          <MetricCard
            value={r.linkCapLabel}
            label="Link cap"
            colorClass={
              r.linkCap <= 1 ? "critical" : r.linkCap <= 10 ? "warning" : "ok"
            }
          />
        )}
        {r.linkMode && r.linkMetric && (
          <MetricCard
            value={fmtMetric(r.linkMetric)}
            label="ISIS metric"
            colorClass="info"
          />
        )}
        {r.linkCong?.flows?.length > 0 && (
          <MetricCard
            value={
              r.linkCong.flows.filter(
                (f) => f.risk === "CRITICAL" || f.risk === "HIGH",
              ).length
            }
            label="Links at risk"
            colorClass={
              r.linkCong.flows.some((f) => f.risk === "CRITICAL")
                ? "critical"
                : "warning"
            }
          />
        )}
      </div>
      <DisruptionBanners aggpe={r.aggpe} />
      <ParallelSection r={r} analyzerRef={analyzerRef} />
      <div
        style={{
          display: "flex",
          borderBottom: `1px solid ${T.border}`,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {tabs.map((t) => (
          <div
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontFamily: T.mono,
              cursor: "pointer",
              borderBottom:
                activeTab === t
                  ? `2px solid ${T.blue}`
                  : "2px solid transparent",
              color: activeTab === t ? T.blue : T.text3,
              transition: "all .15s",
              marginBottom: -1,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {tabLabels[t]}
            {t === "routes" && routesBadge && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: T.amber,
                  display: "inline-block",
                }}
              />
            )}
            {t === "capacity" && capBadge && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: T.red,
                  display: "inline-block",
                }}
              />
            )}
          </div>
        ))}
      </div>
      {activeTab === "recs" && (
        <div>
          {r.recs?.map((rec, i) => (
            <RecItem key={i} rec={rec} />
          ))}
        </div>
      )}
      {activeTab === "iso" && (
        <IsolationPanel
          isolated={r.isolated}
          partitioned={r.partitioned}
          partitionedGroups={r.partitionedGroups}
        />
      )}
      {activeTab === "paths" && <PathsPanel pathImpact={r.pathImpact} />}
      {activeTab === "cong" && (
        <CongestionPanel loadIncrease={r.loadIncrease} />
      )}
      {activeTab === "routes" && <AGGReachabilityPanel aggReach={r.aggReach} />}
      {activeTab === "capacity" && <CapacityPanel linkCong={r.linkCong} />}
    </div>
  );
}

export function CurrentDownResult({ r }) {
  const [activeTab, setActiveTab] = useState("dl");
  const ti = r.pathImpact?.reduce((s, p) => s + p.totalAffected, 0) || 0;
  const tabs = ["dl", "recs", "iso", "dp", "dc", "routes", "capacity"];
  const labels = {
    dl: "Down Links",
    recs: "Recommendations",
    iso: "Isolation",
    dp: "Path Impact",
    dc: "Transit Load",
    routes: "AGG Routes",
    capacity: "Capacity",
  };
  const routesBadge = r.aggReach?.some((s) =>
    s.paths?.some((p) => p.disrupted || p.inflated),
  );
  const capBadge = r.linkCong?.flows?.some(
    (f) => f.risk === "CRITICAL" || f.risk === "HIGH",
  );
  const recsCritical = r.recs?.some((rec) => rec.priority === "CRITICAL");
  const linksAtRisk =
    r.linkCong?.flows?.filter((f) => f.risk === "CRITICAL" || f.risk === "HIGH")
      .length || 0;
  const dlIsolationBadge = r.perLink?.some(
    (l) => l.linkIsolated?.length > 0 || l.linkPartitioned,
  );
  const totalTrafficLost =
    r.perLink?.reduce(
      (s, l) => s + Math.max(l.edgeInputBps || 0, l.edgeOutputBps || 0),
      0,
    ) || 0;
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 22,
              fontWeight: 600,
              color: T.red,
            }}
          >
            Current Outage Impact
          </div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 12,
              color: T.text3,
              marginTop: 2,
            }}
          >
            {r.downCount} link(s) DOWN — real-time assessment
          </div>
          {totalTrafficLost > 0 && (
            <div
              style={{
                fontFamily: T.mono,
                fontSize: 11,
                color: T.amber,
                marginTop: 4,
              }}
            >
              ~{fmtBps(totalTrafficLost)} peak traffic affected
            </div>
          )}
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontFamily: T.mono,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".1em",
              background: SEV_BGS[r.severity],
              border: `1px solid ${SEV_COLORS[r.severity]}`,
              color: SEV_COLORS[r.severity],
            }}
          >
            {r.severity}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <MetricCard
          value={r.downCount}
          label="Links down"
          colorClass={r.downCount > 0 ? "warning" : "ok"}
        />
        <MetricCard
          value={r.isolated?.length || 0}
          label="Isolated nodes"
          colorClass={r.isolated?.length > 0 ? "critical" : "ok"}
        />
        <MetricCard
          value={ti}
          label="Paths degraded"
          colorClass={ti > 0 ? "warning" : "ok"}
        />
        <MetricCard
          value={`+${r.maxInf || 0}`}
          label="Max hop +"
          colorClass={
            r.maxInf >= 3 ? "critical" : r.maxInf >= 1 ? "warning" : "ok"
          }
        />
        <MetricCard
          value={r.loadIncrease?.length || 0}
          label="Transit nodes"
          colorClass={r.loadIncrease?.length > 3 ? "warning" : "ok"}
        />
        {linksAtRisk > 0 && (
          <MetricCard
            value={linksAtRisk}
            label="Links at risk"
            colorClass={
              r.linkCong?.flows?.some((f) => f.risk === "CRITICAL")
                ? "critical"
                : "warning"
            }
          />
        )}
        {r.perLink?.some(
          (l) => l.linkIsolated?.length > 0 || l.linkPartitioned,
        ) && (
          <MetricCard
            value={
              r.perLink.filter(
                (l) => l.linkIsolated?.length > 0 || l.linkPartitioned,
              ).length
            }
            label="Bridge links"
            colorClass="critical"
          />
        )}
        {totalTrafficLost > 0 && (
          <MetricCard
            value={fmtBps(totalTrafficLost)}
            label="Traffic affected"
            colorClass="warning"
          />
        )}
      </div>
      {r.aggpe && <DisruptionBanners aggpe={r.aggpe} />}
      <div
        style={{
          display: "flex",
          borderBottom: `1px solid ${T.border}`,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {tabs.map((t) => (
          <div
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontFamily: T.mono,
              cursor: "pointer",
              borderBottom:
                activeTab === t
                  ? `2px solid ${T.blue}`
                  : "2px solid transparent",
              color: activeTab === t ? T.blue : T.text3,
              transition: "all .15s",
              marginBottom: -1,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {labels[t]}
            {t === "dl" && dlIsolationBadge && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: T.red,
                  display: "inline-block",
                }}
              />
            )}
            {t === "recs" && recsCritical && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: T.red,
                  display: "inline-block",
                }}
              />
            )}
            {t === "routes" && routesBadge && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: T.amber,
                  display: "inline-block",
                }}
              />
            )}
            {t === "capacity" && capBadge && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: T.red,
                  display: "inline-block",
                }}
              />
            )}
          </div>
        ))}
      </div>
      {activeTab === "dl" && <DownLinksPanel perLink={r.perLink} />}
      {activeTab === "recs" && (
        <div>
          {r.recs?.map((rec, i) => (
            <RecItem key={i} rec={rec} />
          ))}
        </div>
      )}
      {activeTab === "iso" && (
        <IsolationPanel
          isolated={r.isolated}
          partitioned={r.partitioned}
          partitionedGroups={r.partGroups}
        />
      )}
      {activeTab === "dp" && <PathsPanel pathImpact={r.pathImpact} />}
      {activeTab === "dc" && <CongestionPanel loadIncrease={r.loadIncrease} />}
      {activeTab === "routes" && <AGGReachabilityPanel aggReach={r.aggReach} />}
      {activeTab === "capacity" && <CapacityPanel linkCong={r.linkCong} />}
    </div>
  );
}

export function NeighborList({ device, analyzerRef }) {
  const g = analyzerRef.current?.baseGraph;
  if (!g || !device) return null;
  const adj = g.adj[device];
  if (!adj || adj.length === 0)
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: T.text3 }}>
        No neighbors found.
      </div>
    );
  const neighborMap = new Map();
  for (const e of adj) {
    if (!neighborMap.has(e.n)) neighborMap.set(e.n, []);
    neighborMap.get(e.n).push(e);
  }
  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".12em",
          color: T.text3,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        Neighbors of {device}
      </div>
      <div
        style={{
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {Array.from(neighborMap.entries()).map(([neighbor, edges]) => (
          <div
            key={neighbor}
            style={{
              padding: "8px 12px",
              borderBottom: `1px solid ${T.border}`,
              background: T.bg3,
            }}
          >
            <div
              style={{
                fontFamily: T.mono,
                fontSize: 11,
                color: T.blue,
                marginBottom: 4,
              }}
            >
              {neighbor}
            </div>
            {edges.map((e, idx) => {
              const util = trafficUtil(e.input_bps, e.output_bps, e.portSpeed);
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 11,
                    fontFamily: T.mono,
                    padding: "3px 0",
                    gap: 8,
                  }}
                >
                  <span style={{ color: T.text2 }}>{e.iface || "—"}</span>
                  <Tag
                    color={e.cap <= 1 ? T.red : e.cap <= 10 ? T.amber : T.green}
                    bg={
                      e.cap <= 1
                        ? "rgba(255,90,90,.15)"
                        : e.cap <= 10
                          ? "rgba(255,179,71,.15)"
                          : "rgba(45,206,138,.15)"
                    }
                  >
                    {ifaceLabel(e.iface, e.portSpeed)}
                  </Tag>
                  {util !== null && <UtilBar util={util} compact />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
