import React, {useState} from "react";
import {T, isAGGNode,} from "./Constants"
import { fmtBps, trafficUtil, fmtMetric, utilColor, ifaceLabel } from "./formatters";
import {Tag, UtilBar, SectionHeader} from "./UIElements"

export function AGGReachabilityPanel({ aggReach }) {
  if (!aggReach || aggReach.length === 0)
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: T.text3,
          fontSize: 12,
          fontFamily: T.mono,
        }}
      >
        No AGG reachability data available.
      </div>
    );
  const capColor = (c) => (c >= 100 ? T.green : c >= 10 ? T.amber : T.red);
  const capBg = (c) =>
    c >= 100
      ? "rgba(45,206,138,.15)"
      : c >= 10
        ? "rgba(255,179,71,.15)"
        : "rgba(255,90,90,.15)";
  const capLbl = (c) => (c >= 100 ? "100G" : c >= 10 ? "10G" : "1G");
  const PathHops = ({ path, color }) => {
    if (!path || path.length === 0)
      return <span style={{ color: T.text3 }}>—</span>;
    const nodes =
      path.length <= 7 ? path : [...path.slice(0, 2), "…", ...path.slice(-2)];
    return (
      <span
        style={{ fontFamily: T.mono, fontSize: 11, color: color || T.text2 }}
      >
        {nodes.map((n, i) => (
          <span key={i}>
            {i > 0 && (
              <span style={{ color: T.text3, margin: "0 4px" }}>→</span>
            )}
            <span
              style={{
                color:
                  n === "…"
                    ? T.text3
                    : isAGGNode(n)
                      ? T.blue
                      : color || T.text2,
              }}
            >
              {n}
            </span>
          </span>
        ))}
      </span>
    );
  };
  return (
    <>
      {aggReach.map(({ source, paths }) => {
        const hasChanges = paths.some((p) => p.disrupted || p.inflated);
        return (
          <div
            key={source}
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              marginBottom: 12,
              overflow: "hidden",
            }}
          >
            <SectionHeader
              icon="⬡"
              iconBg="rgba(74,158,255,.2)"
              iconBorder="rgba(74,158,255,.3)"
            >
              From {source}
              {hasChanges && (
                <Tag
                  color={T.amber}
                  bg="rgba(255,179,71,.1)"
                  style={{ marginLeft: 8 }}
                >
                  paths changed
                </Tag>
              )}
            </SectionHeader>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: T.mono,
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    {[
                      "AGG Target",
                      "Before path",
                      "Before cost",
                      "After path",
                      "After cost",
                      "Change",
                      "Bottleneck",
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "7px 10px",
                          color: T.text3,
                          fontWeight: 500,
                          borderBottom: `1px solid ${T.border}`,
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: ".08em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paths.map(
                    ({
                      agg,
                      before,
                      after,
                      disrupted,
                      inflated,
                      sameRoute,
                      hopDiff,
                      costDiff,
                      afterBottleneck,
                    }) => {
                      const rowBg = disrupted
                        ? "rgba(255,90,90,.04)"
                        : inflated
                          ? "rgba(255,179,71,.04)"
                          : "";
                      const td = {
                        padding: "8px 10px",
                        borderBottom: `1px solid ${T.border}`,
                        verticalAlign: "top",
                      };
                      let changeEl = (
                        <span style={{ color: T.green, fontSize: 11 }}>
                          ✓ same
                        </span>
                      );
                      if (disrupted)
                        changeEl = (
                          <span style={{ color: T.red, fontWeight: 600 }}>
                            UNREACHABLE
                          </span>
                        );
                      else if (inflated)
                        changeEl = (
                          <span>
                            {hopDiff > 0 && (
                              <span
                                style={{
                                  display: "block",
                                  color: T.amber,
                                  fontSize: 11,
                                }}
                              >
                                +{hopDiff} hop{hopDiff > 1 ? "s" : ""}
                              </span>
                            )}
                            {costDiff > 0 && (
                              <span
                                style={{
                                  display: "block",
                                  color: T.amber,
                                  fontSize: 11,
                                }}
                              >
                                +{fmtMetric(costDiff)} metric
                              </span>
                            )}
                          </span>
                        );
                      else if (sameRoute)
                        changeEl = (
                          <span style={{ color: T.green, fontSize: 11 }}>
                            ✓ unchanged
                          </span>
                        );
                      const bnEl = afterBottleneck ? (
                        <Tag
                          color={capColor(afterBottleneck)}
                          bg={capBg(afterBottleneck)}
                        >
                          {capLbl(afterBottleneck)}
                        </Tag>
                      ) : disrupted ? (
                        <span style={{ color: T.red, fontSize: 11 }}>—</span>
                      ) : (
                        <span style={{ color: T.text3, fontSize: 11 }}>—</span>
                      );
                      return (
                        <tr
                          key={agg}
                          style={{ background: rowBg }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = T.bg3)
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = rowBg)
                          }
                        >
                          <td style={{ ...td, color: T.blue, fontWeight: 600 }}>
                            {agg}
                          </td>
                          <td style={td}>
                            {before ? (
                              <PathHops path={before.path} color={T.text2} />
                            ) : (
                              <span style={{ color: T.text3 }}>—</span>
                            )}
                          </td>
                          <td
                            style={{
                              ...td,
                              color: T.text2,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {before ? fmtMetric(before.cost) : "—"}
                          </td>
                          <td style={td}>
                            {disrupted ? (
                              <span style={{ color: T.red }}>✗ No path</span>
                            ) : after ? (
                              <PathHops
                                path={after.path}
                                color={inflated ? T.amber : T.green}
                              />
                            ) : (
                              <span style={{ color: T.text3 }}>—</span>
                            )}
                          </td>
                          <td
                            style={{
                              ...td,
                              color: disrupted
                                ? T.red
                                : inflated
                                  ? T.amber
                                  : T.green,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {disrupted
                              ? "—"
                              : after
                                ? fmtMetric(after.cost)
                                : "—"}
                          </td>
                          <td style={td}>{changeEl}</td>
                          <td style={td}>{bnEl}</td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function CapacityPanel({ linkCong }) {
  if (!linkCong || !linkCong.flows || linkCong.flows.length === 0)
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: T.text3,
          fontSize: 12,
          fontFamily: T.mono,
        }}
      >
        No flows were rerouted through alternate paths — no capacity impact to
        report.
      </div>
    );
  const { flows, total } = linkCong;
  const riskColor = (r) =>
    ({ CRITICAL: T.red, HIGH: T.amber, MEDIUM: T.purple, LOW: T.green })[r] ||
    T.green;
  const riskBg = (r) =>
    ({
      CRITICAL: "rgba(255,90,90,.15)",
      HIGH: "rgba(255,179,71,.15)",
      MEDIUM: "rgba(155,127,255,.15)",
      LOW: "rgba(45,206,138,.15)",
    })[r];
  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <SectionHeader
        icon="⚡"
        iconBg="rgba(255,179,71,.2)"
        iconBorder="rgba(255,179,71,.3)"
      >
        Alternate path capacity impact — {total} flow{total !== 1 ? "s" : ""}{" "}
        rerouted
      </SectionHeader>
      <div style={{ padding: 16 }}>
        <div
          style={{
            fontSize: 12,
            color: T.text3,
            marginBottom: 16,
            lineHeight: 1.6,
          }}
        >
          Each link shows{" "}
          <strong style={{ color: T.text2 }}>live traffic utilisation</strong>{" "}
          (from DB <code style={{ fontFamily: T.mono }}>input_bps</code>/
          <code style={{ fontFamily: T.mono }}>output_bps</code>) and estimated
          additional load from rerouted flows (50 flows per Gbps threshold).
        </div>
        {flows.map(
          ({
            key,
            nodeA,
            nodeB,
            count,
            coveragePct,
            capGbps,
            capLabel,
            satPct,
            risk,
            currentUtil,
            currentInBps,
            currentOutBps,
          }) => {
            const col = riskColor(risk),
              capCol =
                capGbps >= 100 ? T.green : capGbps >= 10 ? T.amber : T.red,
              capBg2 =
                capGbps >= 100
                  ? "rgba(45,206,138,.15)"
                  : capGbps >= 10
                    ? "rgba(255,179,71,.15)"
                    : "rgba(255,90,90,.15)";
            const hasTraffic =
              currentUtil !== null && currentUtil !== undefined;
            // Combined bar: current util + rerouted sat stacked
            const combinedPct = hasTraffic
              ? Math.min(100, currentUtil + satPct)
              : null;
            return (
              <div
                key={key}
                style={{
                  marginBottom: 22,
                  padding: "12px 0",
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      fontFamily: T.mono,
                      fontSize: 13,
                      fontWeight: 600,
                      color: T.text,
                    }}
                  >
                    {nodeA}{" "}
                    <span style={{ color: T.text3, fontWeight: 400 }}>↔</span>{" "}
                    {nodeB}
                  </div>
                  <Tag color={capCol} bg={capBg2}>
                    {capLabel}
                  </Tag>
                  <Tag color={col} bg={riskBg(risk)}>
                    {risk}
                  </Tag>
                  <div
                    style={{
                      marginLeft: "auto",
                      fontFamily: T.mono,
                      fontSize: 11,
                      color: T.text3,
                    }}
                  >
                    {count}/{total} rerouted flows ({coveragePct}%)
                  </div>
                </div>

                {/* Live traffic row */}
                {hasTraffic && (
                  <div style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 10,
                        fontFamily: T.mono,
                        color: T.text3,
                        marginBottom: 3,
                      }}
                    >
                      <span>LIVE TRAFFIC (now)</span>
                      <span>
                        ↓ {fmtBps(currentInBps)} · ↑ {fmtBps(currentOutBps)}
                      </span>
                    </div>
                    <div
                      style={{
                        position: "relative",
                        height: 8,
                        background: T.bg4,
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          height: "100%",
                          width: `${currentUtil}%`,
                          background: utilColor(currentUtil),
                          borderRadius: 3,
                          transition: "width .3s",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 10,
                        fontFamily: T.mono,
                        marginTop: 2,
                      }}
                    >
                      <span
                        style={{
                          color: utilColor(currentUtil),
                          fontWeight: 600,
                        }}
                      >
                        {currentUtil}% utilised
                      </span>
                      <span style={{ color: T.text3 }}>current live load</span>
                    </div>
                  </div>
                )}

                {/* Rerouted flows bar */}
                <div style={{ marginBottom: hasTraffic ? 0 : 0 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: T.mono,
                      color: T.text3,
                      marginBottom: 3,
                    }}
                  >
                    REROUTED FLOWS (estimated additional load)
                  </div>
                  <div
                    style={{
                      position: "relative",
                      height: 8,
                      background: T.bg4,
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        height: "100%",
                        width: `${satPct}%`,
                        background: col,
                        borderRadius: 3,
                        transition: "width .3s",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        height: "100%",
                        width: 2,
                        background: `${T.border2}88`,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10,
                      fontFamily: T.mono,
                      marginTop: 2,
                    }}
                  >
                    <span style={{ color: col, fontWeight: 600 }}>
                      {satPct}% estimated from rerouting
                    </span>
                    <span style={{ color: T.text3 }}>
                      {capGbps}G cap · ~{capGbps * 50} flow threshold
                    </span>
                  </div>
                </div>

                {/* Combined total warning if both are high */}
                {hasTraffic && combinedPct !== null && combinedPct >= 80 && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "6px 10px",
                      background:
                        combinedPct >= 90
                          ? "rgba(255,90,90,.07)"
                          : "rgba(255,179,71,.07)",
                      border: `1px solid ${combinedPct >= 90 ? "rgba(255,90,90,.2)" : "rgba(255,179,71,.2)"}`,
                      borderRadius: 4,
                      fontSize: 11,
                      color: combinedPct >= 90 ? T.red : T.amber,
                    }}
                  >
                    ⚠ Combined estimated utilisation: ~{combinedPct}%.{" "}
                    {combinedPct >= 90
                      ? "This link is likely to congest."
                      : "Monitor closely."}
                  </div>
                )}
                {!hasTraffic && risk === "CRITICAL" && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "6px 10px",
                      background: "rgba(255,90,90,.07)",
                      border: "1px solid rgba(255,90,90,.2)",
                      borderRadius: 4,
                      fontSize: 11,
                      color: T.red,
                    }}
                  >
                    ⚠ This link is likely to become congested.
                  </div>
                )}
                {!hasTraffic && risk === "HIGH" && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "6px 10px",
                      background: "rgba(255,179,71,.07)",
                      border: "1px solid rgba(255,179,71,.2)",
                      borderRadius: 4,
                      fontSize: 11,
                      color: T.amber,
                    }}
                  >
                    Monitor this link closely.
                  </div>
                )}
              </div>
            );
          },
        )}
        <div
          style={{
            fontSize: 11,
            color: T.text3,
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          Live traffic from portSpeed/input_bps/output_bps. Rerouted estimate:
          50 flows per Gbps.
        </div>
      </div>
    </div>
  );
}

export function ParallelSection({ r, analyzerRef }) {
  const g = analyzerRef.current?.baseGraph;
  if (!g) return null;
  if (r.linkMode && r.parallelCount > 1) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          marginBottom: 16,
          overflow: "hidden",
        }}
      >
        <SectionHeader icon="∥">
          Parallel interfaces — {r.nodeA} ↔ {r.nodeB}
        </SectionHeader>
        {/* Current traffic on the failing link */}
        {r.linkTrafficUtil !== null && r.linkTrafficUtil !== undefined && (
          <div
            style={{
              padding: "10px 16px",
              borderBottom: `1px solid ${T.border}`,
              background: "rgba(74,158,255,.04)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: T.text3,
                marginBottom: 4,
                fontFamily: T.mono,
              }}
            >
              LIVE TRAFFIC ON THIS LINK
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{ fontFamily: T.mono, fontSize: 11, color: T.text2 }}
              >
                ↓ {fmtBps(r.linkInputBps)}
              </span>
              <span
                style={{ fontFamily: T.mono, fontSize: 11, color: T.text2 }}
              >
                ↑ {fmtBps(r.linkOutputBps)}
              </span>
              <div style={{ flex: 1, minWidth: 120 }}>
                <UtilBar util={r.linkTrafficUtil} compact />
              </div>
            </div>
          </div>
        )}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: T.mono,
            fontSize: 12,
          }}
        >
          <thead>
            <tr>
              {[
                "Interface",
                "Capacity",
                "ISIS metric",
                "In",
                "Out",
                "Util",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "7px 10px",
                    color: T.text3,
                    fontWeight: 500,
                    borderBottom: `1px solid ${T.border}`,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.parallelIfaces.map(
              ({ iface, cap, metric, portSpeed, input_bps, output_bps }, i) => {
                const cc = cap <= 1 ? T.red : cap <= 10 ? T.amber : T.green,
                  cb =
                    cap <= 1
                      ? "rgba(255,90,90,.15)"
                      : cap <= 10
                        ? "rgba(255,179,71,.15)"
                        : "rgba(45,206,138,.15)";
                const util = trafficUtil(input_bps, output_bps, portSpeed);
                return (
                  <tr key={i}>
                    <td
                      style={{
                        padding: "7px 10px",
                        borderBottom: `1px solid ${T.border}`,
                        color: T.text,
                      }}
                    >
                      {iface || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      <Tag color={cc} bg={cb}>
                        {ifaceLabel(iface, portSpeed)}
                      </Tag>
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        borderBottom: `1px solid ${T.border}`,
                        color: T.text2,
                      }}
                    >
                      {fmtMetric(metric)}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        borderBottom: `1px solid ${T.border}`,
                        color: T.text3,
                        fontSize: 11,
                      }}
                    >
                      {fmtBps(input_bps || 0)}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        borderBottom: `1px solid ${T.border}`,
                        color: T.text3,
                        fontSize: 11,
                      }}
                    >
                      {fmtBps(output_bps || 0)}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        borderBottom: `1px solid ${T.border}`,
                        minWidth: 90,
                      }}
                    >
                      {util !== null ? (
                        <UtilBar util={util} compact />
                      ) : (
                        <span style={{ color: T.text3, fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
        <div
          style={{
            padding: "10px 12px",
            fontSize: 11,
            color: T.text3,
            borderTop: `1px solid ${T.border}`,
          }}
        >
          ⚡ Aggregate:{" "}
          <strong style={{ color: T.blue }}>{r.totalLinkCap}G</strong> across{" "}
          {r.parallelCount} interfaces
        </div>
      </div>
    );
  }
  if (!r.linkMode && r.neighbors && r.neighbors.length > 0) {
    const thStyle = {
      textAlign: "left",
      padding: "7px 10px",
      color: T.text3,
      fontWeight: 500,
      borderBottom: `1px solid ${T.border}`,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: ".08em",
    };
    const rows = [];
    r.neighbors.forEach((neighbor) => {
      const devEdges = (g.adj[r.target] || []).filter((e) => e.n === neighbor);
      const nbEdges = (g.adj[neighbor] || []).filter((e) => e.n === r.target);
      const count = devEdges.length;
      const totalCap = devEdges.reduce((s, e) => s + (e.cap || 1), 0);
      const capCol = totalCap <= 1 ? T.red : totalCap <= 10 ? T.amber : T.green,
        capBg =
          totalCap <= 1
            ? "rgba(255,90,90,.15)"
            : totalCap <= 10
              ? "rgba(255,179,71,.15)"
              : "rgba(45,206,138,.15)";
      if (count === 0) {
        rows.push(
          <tr key={neighbor}>
            <td
              colSpan={7}
              style={{
                padding: "7px 10px",
                borderBottom: `1px solid ${T.border}`,
                color: T.text3,
              }}
            >
              {neighbor} — no edge data
            </td>
          </tr>,
        );
        return;
      }
      devEdges.forEach((de, idx) => {
        const ne = nbEdges[idx] || null;
        const devIf = de.iface || "—",
          nbIf = ne ? ne.iface || "—" : "—";
        const cc = de.cap <= 1 ? T.red : de.cap <= 10 ? T.amber : T.green,
          cb =
            de.cap <= 1
              ? "rgba(255,90,90,.15)"
              : de.cap <= 10
                ? "rgba(255,179,71,.15)"
                : "rgba(45,206,138,.15)";
        const metricVal =
          typeof de.metric === "number" && de.metric > 0 ? de.metric : null;
        const util = trafficUtil(de.input_bps, de.output_bps, de.portSpeed);
        const tdS = {
          padding: "7px 10px",
          borderBottom:
            count > 1 && idx < count - 1
              ? `1px dashed rgba(42,58,86,.8)`
              : `1px solid ${T.border}`,
          verticalAlign: "middle",
        };
        if (idx === 0) {
          rows.push(
            <tr key={`${neighbor}-${idx}`}>
              <td
                rowSpan={count}
                style={{
                  ...tdS,
                  fontFamily: T.mono,
                  color: T.text,
                  verticalAlign: "top",
                }}
              >
                {neighbor}
              </td>
              <td
                rowSpan={count}
                style={{
                  ...tdS,
                  fontFamily: T.mono,
                  fontWeight: 600,
                  color: T.blue,
                  textAlign: "center",
                  verticalAlign: "top",
                }}
              >
                {count}
              </td>
              <td
                style={{
                  ...tdS,
                  fontFamily: T.mono,
                  fontSize: 11,
                  color: T.text2,
                }}
              >
                {devIf}&nbsp;
                <Tag color={cc} bg={cb}>
                  {ifaceLabel(devIf, de.portSpeed)}
                </Tag>
              </td>
              <td
                style={{
                  ...tdS,
                  fontFamily: T.mono,
                  fontSize: 11,
                  color: T.text2,
                }}
              >
                {nbIf}
                {ne && (
                  <>
                    &nbsp;
                    <Tag color={cc} bg={cb}>
                      {ifaceLabel(nbIf, ne.portSpeed)}
                    </Tag>
                  </>
                )}
              </td>
              <td
                rowSpan={count}
                style={{
                  ...tdS,
                  fontFamily: T.mono,
                  fontSize: 11,
                  color: T.text3,
                  textAlign: "right",
                  verticalAlign: "top",
                }}
              >
                {fmtMetric(metricVal)}
              </td>
              <td rowSpan={count} style={{ ...tdS, verticalAlign: "top" }}>
                <Tag color={capCol} bg={capBg}>
                  {totalCap}G
                </Tag>
              </td>
              <td
                rowSpan={count}
                style={{ ...tdS, verticalAlign: "top", minWidth: 90 }}
              >
                {util !== null ? (
                  <UtilBar util={util} compact />
                ) : (
                  <span style={{ color: T.text3, fontSize: 10 }}>—</span>
                )}
              </td>
            </tr>,
          );
        } else {
          rows.push(
            <tr key={`${neighbor}-${idx}`}>
              <td
                style={{
                  ...tdS,
                  fontFamily: T.mono,
                  fontSize: 11,
                  color: T.text2,
                }}
              >
                {devIf}&nbsp;
                <Tag color={cc} bg={cb}>
                  {ifaceLabel(devIf, de.portSpeed)}
                </Tag>
              </td>
              <td
                style={{
                  ...tdS,
                  fontFamily: T.mono,
                  fontSize: 11,
                  color: T.text2,
                }}
              >
                {nbIf}
                {ne && (
                  <>
                    &nbsp;
                    <Tag color={cc} bg={cb}>
                      {ifaceLabel(nbIf, ne.portSpeed)}
                    </Tag>
                  </>
                )}
              </td>
            </tr>,
          );
        }
      });
    });
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          marginBottom: 16,
          overflow: "hidden",
        }}
      >
        <SectionHeader icon="∥">Interfaces — {r.target}</SectionHeader>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: T.mono,
              fontSize: 12,
            }}
          >
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 140 }}>Neighbor</th>
                <th style={{ ...thStyle, width: 28, textAlign: "center" }}>
                  #
                </th>
                <th style={thStyle}>{r.target} interface</th>
                <th style={thStyle}>Neighbor interface</th>
                <th style={{ ...thStyle, width: 80, textAlign: "right" }}>
                  Metric
                </th>
                <th style={{ ...thStyle, width: 60 }}>Cap</th>
                <th style={{ ...thStyle, width: 100 }}>Utilisation</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      </div>
    );
  }
  return null;
}

export function PathsPanel({ pathImpact }) {
  const [expanded, setExpanded] = useState({});
  const [showMore, setShowMore] = useState(false);
  if (!pathImpact || pathImpact.length === 0)
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: T.text3,
          fontSize: 12,
          fontFamily: T.mono,
        }}
      >
        ✓ No significant path inflation detected.
      </div>
    );
  const VG = 4,
    VR = 8,
    thStyle = {
      textAlign: "left",
      padding: "7px 10px",
      color: T.text3,
      fontWeight: 500,
      borderBottom: `1px solid ${T.border}`,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: ".08em",
    };
  const visible = showMore ? pathImpact : pathImpact.slice(0, VG);
  return (
    <>
      {visible.map(({ source, affected, totalAffected }, gi) => {
        const exp = expanded[gi];
        const rows = exp ? affected : affected.slice(0, VR);
        return (
          <div
            key={gi}
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              marginBottom: 12,
              overflow: "hidden",
            }}
          >
            <SectionHeader
              icon="↗"
              iconBg="rgba(255,179,71,.2)"
              iconBorder="rgba(255,179,71,.3)"
            >
              From {source} — {totalAffected} path(s) impacted
            </SectionHeader>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: T.mono,
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    {[
                      "Destination",
                      "Hops before",
                      "Hops after",
                      "Δ hops",
                      "Metric before",
                      "Metric after",
                      "Δ metric",
                    ].map((h) => (
                      <th key={h} style={thStyle}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a, ri) => {
                    const aStr = a.type === "unreachable" ? "✗" : a.afterHops;
                    const aCls =
                      a.type === "unreachable"
                        ? T.red
                        : a.hopDiff >= 3
                          ? T.amber
                          : a.hopDiff > 0
                            ? T.amber
                            : T.green;
                    let infTag = null;
                    if (a.type === "unreachable")
                      infTag = (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontSize: 10,
                            marginLeft: 4,
                            background: "rgba(255,90,90,.2)",
                            color: T.red,
                          }}
                        >
                          UNREACHABLE
                        </span>
                      );
                    else if (a.hopDiff >= 3)
                      infTag = (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontSize: 10,
                            marginLeft: 4,
                            background: "rgba(255,90,90,.2)",
                            color: T.red,
                          }}
                        >
                          +{a.hopDiff}
                        </span>
                      );
                    else if (a.hopDiff >= 2)
                      infTag = (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontSize: 10,
                            marginLeft: 4,
                            background: "rgba(255,179,71,.2)",
                            color: T.amber,
                          }}
                        >
                          +{a.hopDiff}
                        </span>
                      );
                    else if (a.hopDiff > 0)
                      infTag = (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontSize: 10,
                            marginLeft: 4,
                            background: "rgba(155,127,255,.2)",
                            color: T.purple,
                          }}
                        >
                          +{a.hopDiff}
                        </span>
                      );
                    let costTag = null;
                    if (a.costDiff > 50000)
                      costTag = (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontSize: 10,
                            marginLeft: 4,
                            background: "rgba(255,90,90,.2)",
                            color: T.red,
                          }}
                        >
                          +{fmtMetric(a.costDiff)}
                        </span>
                      );
                    else if (a.costDiff > 5000)
                      costTag = (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontSize: 10,
                            marginLeft: 4,
                            background: "rgba(255,179,71,.2)",
                            color: T.amber,
                          }}
                        >
                          +{fmtMetric(a.costDiff)}
                        </span>
                      );
                    else if (a.costDiff > 0)
                      costTag = (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontSize: 10,
                            marginLeft: 4,
                            background: "rgba(155,127,255,.2)",
                            color: T.purple,
                          }}
                        >
                          +{fmtMetric(a.costDiff)}
                        </span>
                      );
                    const td = {
                      padding: "7px 10px",
                      borderBottom: `1px solid ${T.border}`,
                      verticalAlign: "middle",
                    };
                    return (
                      <tr
                        key={ri}
                        style={{ cursor: "default" }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = T.bg3)
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "")
                        }
                      >
                        <td style={{ ...td, color: T.text }}>{a.dest}</td>
                        <td style={{ ...td, color: T.text2 }}>
                          {a.beforeHops ?? "—"}
                        </td>
                        <td style={{ ...td, fontWeight: 600, color: aCls }}>
                          {aStr}
                          {infTag}
                        </td>
                        <td style={{ ...td, color: T.text3, fontSize: 11 }}>
                          {a.hopDiff !== null ? a.hopDiff : "—"}
                        </td>
                        <td style={{ ...td, color: T.text2, fontSize: 11 }}>
                          {fmtMetric(a.beforeCost)}
                        </td>
                        <td
                          style={{
                            ...td,
                            color: a.type === "unreachable" ? T.red : T.text2,
                            fontSize: 11,
                          }}
                        >
                          {a.type === "unreachable"
                            ? "—"
                            : fmtMetric(a.afterCost)}
                        </td>
                        <td style={{ ...td, fontSize: 11 }}>
                          {a.costDiff !== null && a.costDiff !== undefined
                            ? costTag || fmtMetric(a.costDiff)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}{" "}
                  {affected.length > VR && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{ textAlign: "center", padding: 8 }}
                      >
                        <span
                          onClick={() =>
                            setExpanded((e) => ({ ...e, [gi]: !e[gi] }))
                          }
                          style={{
                            color: T.blue,
                            cursor: "pointer",
                            fontSize: 11,
                            fontFamily: T.mono,
                          }}
                        >
                          {exp
                            ? `▾ fewer`
                            : `▸ show ${affected.length - VR} more`}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}{" "}
      {pathImpact.length > VG && (
        <div style={{ textAlign: "center", padding: 10 }}>
          <span
            onClick={() => setShowMore((s) => !s)}
            style={{
              color: T.blue,
              cursor: "pointer",
              fontSize: 12,
              fontFamily: T.mono,
            }}
          >
            {showMore
              ? `▾ fewer sources`
              : `▸ show ${pathImpact.length - VG} more sources`}
          </span>
        </div>
      )}
    </>
  );
}

export function CongestionPanel({ loadIncrease }) {
  if (!loadIncrease || loadIncrease.length === 0)
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: T.text3,
          fontSize: 12,
          fontFamily: T.mono,
        }}
      >
        No significant traffic redistribution. Congestion risk is low.
      </div>
    );
  const ml = loadIncrease[0]?.increase || 1;
  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <SectionHeader
        icon="⟳"
        iconBg="rgba(255,179,71,.2)"
        iconBorder="rgba(255,179,71,.3)"
      >
        Nodes with increased transit load
      </SectionHeader>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: T.text3, marginBottom: 14 }}>
          Additional path-flows per node after failure. Low-speed (1G) ports
          saturate first.
        </div>
        {loadIncrease.map(({ node, increase, capLabel, minCap, risk }) => {
          const pct = Math.round((increase / ml) * 100),
            col =
              risk === "HIGH"
                ? T.red
                : pct > 75
                  ? T.red
                  : pct > 40
                    ? T.amber
                    : T.purple;
          const cc = minCap <= 1 ? T.red : minCap <= 10 ? T.amber : T.green,
            cb =
              minCap <= 1
                ? "rgba(255,90,90,.15)"
                : minCap <= 10
                  ? "rgba(255,179,71,.15)"
                  : "rgba(45,206,138,.15)";
          return (
            <div
              key={node}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div
                style={{
                  fontFamily: T.mono,
                  fontSize: 11,
                  width: 130,
                  flexShrink: 0,
                  color: T.text2,
                }}
              >
                {node}
              </div>
              <Tag color={cc} bg={cb}>
                {capLabel}
              </Tag>
              <div
                style={{
                  flex: 1,
                  height: 6,
                  background: T.bg4,
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 3,
                    width: `${pct}%`,
                    background: col,
                  }}
                />
              </div>
              <div
                style={{
                  fontFamily: T.mono,
                  fontSize: 11,
                  width: 40,
                  textAlign: "right",
                  color: col,
                }}
              >
                +{increase}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function IsolationPanel({ isolated, partitioned, partitionedGroups }) {
  if ((!isolated || isolated.length === 0) && !partitioned)
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: T.text3,
          fontSize: 12,
          fontFamily: T.mono,
        }}
      >
        ✓ No devices become isolated. Topology remains fully connected.
      </div>
    );
  return (
    <>
      {isolated && isolated.length > 0 && (
        <div
          style={{
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            marginBottom: 16,
            overflow: "hidden",
          }}
        >
          <SectionHeader
            icon="✗"
            iconBg="rgba(255,90,90,.2)"
            iconBorder="rgba(255,90,90,.3)"
          >
            Isolated nodes ({isolated.length})
          </SectionHeader>
          <div style={{ padding: 16 }}>
            {isolated.map(({ node, reason, self }) => (
              <div
                key={node}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: T.red,
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${T.red}`,
                  }}
                />
                <div>
                  <div
                    style={{ fontFamily: T.mono, color: T.red, fontSize: 13 }}
                  >
                    {node}
                    {self ? " (self)" : ""}
                  </div>
                  <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                    {reason}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {partitioned && partitionedGroups && partitionedGroups.length > 0 && (
        <div
          style={{
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <SectionHeader
            icon="⚡"
            iconBg="rgba(255,90,90,.2)"
            iconBorder="rgba(255,90,90,.3)"
          >
            Partitioned groups
          </SectionHeader>
          <div style={{ padding: 16 }}>
            {partitionedGroups.map((grp, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 11,
                    color: T.amber,
                    marginBottom: 6,
                  }}
                >
                  Group {i + 1} ({grp.length})
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {grp.map((n) => (
                    <Tag key={n} color={T.amber} bg="rgba(255,179,71,.1)">
                      {n}
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function DownLinksPanel({ perLink }) {
  const impColors = {
    CRITICAL: T.red,
    HIGH: T.amber,
    MEDIUM: T.purple,
    LOW: T.green,
  };
  const impBgs = {
    CRITICAL: "rgba(255,90,90,.06)",
    HIGH: "rgba(255,179,71,.06)",
    MEDIUM: "rgba(155,127,255,.06)",
    LOW: "rgba(45,206,138,.06)",
  };
  return (
    <>
      {perLink.map((l, i) => {
        const col = impColors[l.impact],
          bg = impBgs[l.impact];
        const cc = l.cap <= 1 ? T.red : l.cap <= 10 ? T.amber : T.green,
          cb =
            l.cap <= 1
              ? "rgba(255,90,90,.15)"
              : l.cap <= 10
                ? "rgba(255,179,71,.15)"
                : "rgba(45,206,138,.15)";
        const details = [];
        if (l.aIsolated)
          details.push(
            <span key="a" style={{ color: T.red }}>
              ⚠ {l.a} is ISOLATED (no remaining adjacencies)
            </span>,
          );
        if (l.bIsolated)
          details.push(
            <span key="b" style={{ color: T.red }}>
              ⚠ {l.b} is ISOLATED (no remaining adjacencies)
            </span>,
          );
        if (!l.pathAfter && l.pathBefore)
          details.push(
            <span key="np" style={{ color: T.red }}>
              ⚠ No alternate path between {l.a} and {l.b}
            </span>,
          );
        else if (l.hopInflation > 0)
          details.push(
            <span key="hi" style={{ color: T.amber }}>
              Path inflation: +{l.hopInflation} hop
              {l.hopInflation > 1 ? "s" : ""} / +{fmtMetric(l.costInflation)}{" "}
              metric cost
            </span>,
          );
        else if (l.pathBefore && l.pathAfter)
          details.push(
            <span key="alt" style={{ color: T.green }}>
              Alternate path available: {l.pathAfter.hops} hops (was{" "}
              {l.pathBefore.hops})
            </span>,
          );
        if (l.level >= 2)
          details.push(
            <span key="lvl" style={{ color: T.amber }}>
              Level-{l.level} backbone — inter-area routing affected
            </span>,
          );
        if (l.metric)
          details.push(
            <span key="m" style={{ color: T.text2 }}>
              ISIS metric: {fmtMetric(l.metric)}
            </span>,
          );
        if (l.parallelCount > 1) {
          if (l.remainingCount > 0)
            details.push(
              <span key="par" style={{ color: T.blue }}>
                ∥ {l.remainingCount}/{l.parallelCount} parallel still UP (
                {l.remainingCap}G remaining)
              </span>,
            );
          else
            details.push(
              <span key="par" style={{ color: T.red }}>
                ∥ All {l.parallelCount} parallel interfaces DOWN
              </span>,
            );
        }
        const hasLinkIsolation = l.linkIsolated && l.linkIsolated.length > 0;
        const hasLinkPartition =
          l.linkPartitioned &&
          (!hasLinkIsolation || l.linkPartitionGroups?.length > 0);
        const hasTraffic =
          l.trafficUtilPct !== null && l.trafficUtilPct !== undefined;
        return (
          <div
            key={i}
            style={{
              padding: 14,
              borderRadius: 6,
              marginBottom: 16,
              borderLeft: `3px solid ${col}`,
              background: bg,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 10,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontFamily: T.mono,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  color: col,
                }}
              >
                ● {l.impact}
              </div>
              <div
                style={{
                  fontFamily: T.mono,
                  fontSize: 14,
                  fontWeight: 600,
                  color: T.text,
                }}
              >
                {l.a} <span style={{ color: T.red }}>✗</span> {l.b}
              </div>
              <Tag color={cc} bg={cb}>
                {l.capLabel}
                {l.iface ? " · " + l.iface : ""}
              </Tag>
              {l.level && (
                <Tag color={T.amber} bg="rgba(255,179,71,.15)">
                  L{l.level}
                </Tag>
              )}
              {l.parallelCount > 1 && <Tag>× {l.parallelCount} parallel</Tag>}
            </div>

            {/* Traffic at time of failure */}
            {hasTraffic && (
              <div
                style={{
                  padding: "8px 10px",
                  background: "rgba(74,158,255,.05)",
                  border: `1px solid ${T.border}`,
                  borderRadius: 4,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: T.mono,
                    color: T.text3,
                    marginBottom: 4,
                  }}
                >
                  TRAFFIC AT TIME OF FAILURE
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{ fontFamily: T.mono, fontSize: 11, color: T.text2 }}
                  >
                    ↓ {fmtBps(l.edgeInputBps)}
                  </span>
                  <span
                    style={{ fontFamily: T.mono, fontSize: 11, color: T.text2 }}
                  >
                    ↑ {fmtBps(l.edgeOutputBps)}
                  </span>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <UtilBar util={l.trafficUtilPct} compact />
                  </div>
                  {l.trafficUtilPct >= 70 && (
                    <Tag color={T.amber} bg="rgba(255,179,71,.15)">
                      high utilisation
                    </Tag>
                  )}
                </div>
              </div>
            )}

            {details.length > 0 && (
              <div style={{ fontSize: 12, color: T.text2, marginBottom: 8 }}>
                {details.map((d, di) => (
                  <div key={di} style={{ marginBottom: 3 }}>
                    {d}
                  </div>
                ))}
              </div>
            )}
            <div
              style={{
                fontSize: 10,
                color: T.text3,
                marginBottom: hasLinkIsolation || hasLinkPartition ? 10 : 0,
              }}
            >
              Down since {l.since || "unknown"} · {l.duration || "unknown"}
            </div>

            {hasLinkIsolation && (
              <div
                style={{
                  marginTop: 8,
                  padding: "10px 12px",
                  background: "rgba(255,90,90,.08)",
                  border: "1px solid rgba(255,90,90,.3)",
                  borderRadius: 5,
                }}
              >
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    color: T.red,
                    marginBottom: 8,
                  }}
                >
                  ✗ BRIDGE LINK — {l.linkIsolated.length} NODE
                  {l.linkIsolated.length > 1 ? "S" : ""} ISOLATED BY THIS
                  FAILURE ALONE
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  {l.linkIsolated.map((iso, ii) => (
                    <div
                      key={ii}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        fontSize: 11,
                        fontFamily: T.mono,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: T.red,
                          flexShrink: 0,
                          marginTop: 3,
                          boxShadow: `0 0 4px ${T.red}`,
                        }}
                      />
                      <div>
                        <span style={{ color: T.red, fontWeight: 600 }}>
                          {iso.node}
                        </span>
                        <span style={{ color: T.text3, marginLeft: 6 }}>
                          — {iso.reason}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {l.linkPartitionGroups && l.linkPartitionGroups.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 8,
                      borderTop: "1px solid rgba(255,90,90,.2)",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: T.mono,
                        fontSize: 10,
                        color: T.red,
                        fontWeight: 600,
                        marginBottom: 6,
                      }}
                    >
                      PARTITION GROUPS
                    </div>
                    {l.linkPartitionGroups.map((grp, gi) => (
                      <div key={gi} style={{ marginBottom: 6 }}>
                        <span
                          style={{
                            fontFamily: T.mono,
                            fontSize: 10,
                            color: T.amber,
                          }}
                        >
                          Group {gi + 1} ({grp.length}):&nbsp;
                        </span>
                        <span
                          style={{
                            fontFamily: T.mono,
                            fontSize: 10,
                            color: T.text2,
                          }}
                        >
                          {grp.slice(0, 6).join(", ")}
                          {grp.length > 6 ? ` … +${grp.length - 6} more` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: T.text3,
                    fontStyle: "italic",
                  }}
                >
                  This link is a bridge — add a redundant path for the isolated
                  nodes.
                </div>
              </div>
            )}

            {!hasLinkIsolation &&
              hasLinkPartition &&
              l.linkPartitionGroups?.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "10px 12px",
                    background: "rgba(255,179,71,.08)",
                    border: "1px solid rgba(255,179,71,.3)",
                    borderRadius: 5,
                  }}
                >
                  <div
                    style={{
                      fontFamily: T.mono,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: ".1em",
                      color: T.amber,
                      marginBottom: 8,
                    }}
                  >
                    ⚡ BRIDGE LINK — NETWORK PARTITIONS ON THIS FAILURE ALONE
                  </div>
                  {l.linkPartitionGroups.map((grp, gi) => (
                    <div key={gi} style={{ marginBottom: 6 }}>
                      <span
                        style={{
                          fontFamily: T.mono,
                          fontSize: 10,
                          color: T.amber,
                        }}
                      >
                        Island {gi + 1} ({grp.length}):&nbsp;
                      </span>
                      <span
                        style={{
                          fontFamily: T.mono,
                          fontSize: 10,
                          color: T.text2,
                        }}
                      >
                        {grp.slice(0, 6).join(", ")}
                        {grp.length > 6 ? ` … +${grp.length - 6} more` : ""}
                      </span>
                    </div>
                  ))}
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: T.text3,
                      fontStyle: "italic",
                    }}
                  >
                    Add an alternate path to prevent this partition.
                  </div>
                </div>
              )}
          </div>
        );
      })}
    </>
  );
}
