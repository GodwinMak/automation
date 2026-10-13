import React, { useState, useEffect, useRef, useCallback } from "react";
import { T, isAGGNode, isPENode } from "./Constants";
import {ISISImpactAnalyzer} from "./GraphEngine"
import {AnalysisResult, CurrentDownResult, NeighborList, } from "./Results"

const API_BASE = "http://10.169.209.217:4000/isis-adjacency";

const ISISImpact = () => {
  const [mode, setModeState] = useState("node");
  const [selectedDevice, setSel] = useState(null);
  const [selectedLinkA, setLinkA] = useState(null);
  const [selectedLinkB, setLinkB] = useState(null);
  const [filter, setFilter] = useState("");
  const [downCount, setDownCount] = useState("Loading…");
  const [allEdges, setAllEdges] = useState([]);
  const [downLinks, setDownLinks] = useState([]);
  const [nodeIPs, setNodeIPs] = useState({});
  const [result, setResult] = useState(null);
  const [showDown, setShowDown] = useState(false);
  const analyzerRef = useRef(null);
  // Fingerprint of the downLinks last fed into analyzeCurrentDown() — that
  // analysis rebuilds graphs and runs nested-loop path computations, so skip
  // rerunning it on every 3-minute poll when nothing actually changed.
  const lastAnalyzedDownLinksRef = useRef(null);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/impact-data`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAllEdges(data.allEdges || []);
      setDownLinks(data.downLinks || []);
      setNodeIPs(data.nodeIPs || {});
      analyzerRef.current = new ISISImpactAnalyzer(
        data.allEdges || [],
        data.downLinks || [],
      );
      setDownCount(
        data.downLinks?.length > 0
          ? `${data.downLinks.length} adjacency DOWN`
          : "All links UP",
      );
      if (data.downLinks?.length > 0) {
        const fingerprint = JSON.stringify(data.downLinks);
        if (fingerprint !== lastAnalyzedDownLinksRef.current) {
          const r = analyzerRef.current.analyzeCurrentDown();
          if (r) {
            setResult({ _type: "down", data: r });
            setShowDown(true);
          }
          lastAnalyzedDownLinksRef.current = fingerprint;
        }
      } else {
        lastAnalyzedDownLinksRef.current = null;
      }
    } catch (err) {
      console.error("[ISIS]", err);
      setDownCount("API error");
    }
  }, []);

  useEffect(() => {
    fetchTopology();
    const iv = setInterval(fetchTopology, 3 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchTopology]);

  const setMode = (m) => {
    setModeState(m);
    setSel(null);
    setLinkA(null);
    setLinkB(null);
  };
  const allDevices = analyzerRef.current
    ? analyzerRef.current.baseGraph.allNodes().sort()
    : [];
  const filtered = filter
    ? allDevices.filter((d) => d.toLowerCase().includes(filter.toLowerCase()))
    : allDevices;
  const runAnalysis = () => {
    if (!analyzerRef.current) return;
    let r;
    if (mode === "link") {
      if (!selectedLinkA || !selectedLinkB) {
        alert("Select two devices.");
        return;
      }
      r = analyzerRef.current.analyzeLink(selectedLinkA, selectedLinkB);
    } else {
      if (!selectedDevice) {
        alert("Select a device.");
        return;
      }
      r = analyzerRef.current.analyzeNode(selectedDevice);
    }
    setResult({ _type: "analysis", data: r });
    setShowDown(false);
  };
  const selectLinkNode = (d) => {
    if (!selectedLinkA) {
      setLinkA(d);
    } else if (!selectedLinkB && d !== selectedLinkA) {
      setLinkB(d);
    } else {
      setLinkA(d);
      setLinkB(null);
    }
  };
  const preSelectLink = (a, b) => {
    setMode("link");
    setLinkA(a);
    setLinkB(b);
    if (analyzerRef.current) {
      const r = analyzerRef.current.analyzeLink(a, b);
      setResult({ _type: "analysis", data: r });
      setShowDown(false);
    }
  };
  const showCurrentDown = () => {
    if (!analyzerRef.current || downLinks.length === 0) return;
    const r = analyzerRef.current.analyzeCurrentDown();
    if (r) {
      setResult({ _type: "down", data: r });
      setShowDown(true);
    }
  };
  const hasResult = result && result.data;
  const isDownView = showDown && result?._type === "down";
  return (
    <div
      style={{
        background: T.bg,
        color: T.text,
        fontFamily: T.sans,
        minHeight: "100vh",
        fontSize: 14,
        lineHeight: 1.5,
        display: "grid",
        gridTemplateRows: "auto 1fr",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap');::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:${T.bg2}}::-webkit-scrollbar-thumb{background:${T.bg4};border-radius:3px}*{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div
        style={{
          padding: "14px 24px",
          background: T.bg2,
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: ".08em",
              color: T.blue,
              textTransform: "uppercase",
            }}
          >
            ISIS Impact Analyzer
          </div>
          <div style={{ fontSize: 12, color: T.text3 }}>
            Metric‑aware Dijkstra · Live traffic utilisation · Capacity impact
            analysis
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: T.mono,
            background: "rgba(255,90,90,.12)",
            border: "1px solid rgba(255,90,90,.3)",
            color: T.red,
            marginLeft: "auto",
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: T.red,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}`}</style>
          <span>{downCount}</span>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: T.bg2,
            borderRight: `1px solid ${T.border}`,
            overflowY: "auto",
            padding: 20,
          }}
        >
          <div style={{ marginBottom: 20 }}>
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
              Failure Mode
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
                marginBottom: 16,
              }}
            >
              {["node", "link"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: `1px solid ${mode === m ? T.blue2 : T.border}`,
                    background: mode === m ? "rgba(74,158,255,.1)" : T.bg3,
                    color: mode === m ? T.blue : T.text2,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: T.mono,
                    transition: "all .15s",
                  }}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)} failure
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
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
              Select device
            </div>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <span
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: T.text3,
                  fontSize: 14,
                  pointerEvents: "none",
                }}
              >
                ⌕
              </span>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter devices…"
                style={{
                  width: "100%",
                  background: T.bg3,
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  padding: "8px 12px 8px 32px",
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>
            <div
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                overflow: "hidden",
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {filtered.map((d) => {
                const g = analyzerRef.current?.baseGraph;
                if (!g) return null;
                const deg = g.degree(d),
                  ec = g.edgeCount(d),
                  lvl = g.maxLevel(d),
                  mc = g.minCapacity(d);
                const tierColor =
                  lvl >= 3 ? T.purple : lvl >= 2 ? T.amber : T.green;
                const ct = mc <= 1 ? "1G" : mc <= 10 ? "10G" : "100G";
                const pt = ec > deg ? ` · ${ec}ifaces` : "";
                const role = isAGGNode(d) ? "⬡ " : isPENode(d) ? "◈ " : "";
                const isSelNode = mode === "node" && d === selectedDevice,
                  isSelLink =
                    mode === "link" &&
                    (d === selectedLinkA || d === selectedLinkB),
                  sel = isSelNode || isSelLink;
                return (
                  <div
                    key={d}
                    onClick={() =>
                      mode === "node"
                        ? d === selectedDevice
                          ? runAnalysis()
                          : setSel(d)
                        : selectLinkNode(d)
                    }
                    onDoubleClick={() => {
                      if (mode === "node") {
                        setSel(d);
                        runAnalysis();
                      }
                    }}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderBottom: `1px solid ${T.border}`,
                      background: sel ? "rgba(74,158,255,.1)" : undefined,
                      borderLeft: sel ? `2px solid ${T.blue}` : undefined,
                      fontFamily: T.mono,
                      fontSize: 11,
                      transition: "background .1s",
                    }}
                    onMouseEnter={(e) => {
                      if (!sel) e.currentTarget.style.background = T.bg3;
                    }}
                    onMouseLeave={(e) => {
                      if (!sel) e.currentTarget.style.background = "";
                    }}
                  >
                    <div
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: tierColor,
                      }}
                    />
                    <div style={{ color: T.text, flex: 1 }}>
                      {role}
                      {d}
                    </div>
                    <div style={{ color: T.text3, fontSize: 10 }}>
                      {ct}·deg:{deg}
                      {pt}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {mode === "node" && selectedDevice && (
            <NeighborList device={selectedDevice} analyzerRef={analyzerRef} />
          )}
          <button
            onClick={runAnalysis}
            style={{
              width: "100%",
              padding: 11,
              borderRadius: 6,
              marginTop: 16,
              background: T.blue3,
              border: `1px solid ${T.blue2}`,
              color: "#fff",
              fontFamily: T.mono,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: ".06em",
              transition: "all .15s",
            }}
            onMouseEnter={(e) => (e.target.style.background = T.blue2)}
            onMouseLeave={(e) => (e.target.style.background = T.blue3)}
          >
            ▶ ANALYZE IMPACT
          </button>
          <div
            style={{
              marginTop: 20,
              padding: 12,
              background: T.bg3,
              borderRadius: 6,
              border: `1px solid ${T.border}`,
            }}
          >
            <div
              style={{
                fontFamily: T.mono,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".12em",
                color: T.text3,
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Current faults (live)
            </div>
            {downLinks.length === 0 ? (
              <div style={{ fontSize: 11, color: T.green, fontFamily: T.mono }}>
                ✓ No active faults
              </div>
            ) : (
              <>
                {downLinks.map(({ a, b, since, duration }, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 8,
                      background: "rgba(255,90,90,.06)",
                      border: "1px solid rgba(255,90,90,.2)",
                      borderRadius: 4,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: T.mono,
                        fontSize: 11,
                        color: T.red,
                        cursor: "pointer",
                      }}
                      onClick={() => preSelectLink(a, b)}
                    >
                      {a}
                      <br />↔ {b}
                    </div>
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>
                      Down since {since} · {duration}
                    </div>
                  </div>
                ))}
                <button
                  onClick={showCurrentDown}
                  style={{
                    width: "100%",
                    marginTop: 8,
                    padding: 7,
                    borderRadius: 4,
                    background: "rgba(255,90,90,.1)",
                    border: "1px solid rgba(255,90,90,.25)",
                    color: T.red,
                    fontFamily: T.mono,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                    letterSpacing: ".06em",
                  }}
                >
                  ⚡ FULL OUTAGE IMPACT
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ overflowY: "auto", padding: 24 }}>
          {!hasResult ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: T.text3,
                textAlign: "center",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 48, opacity: 0.3 }}>⬡</div>
              <div style={{ fontFamily: T.mono, fontSize: 13, color: T.text2 }}>
                Select a device and run analysis
              </div>
              <div style={{ fontSize: 12, maxWidth: 340 }}>
                Live traffic utilisation · Best path to AGG · Capacity impact ·
                PE disruption detection
              </div>
            </div>
          ) : isDownView ? (
            <CurrentDownResult r={result.data} />
          ) : (
            <AnalysisResult
              r={result.data}
              analyzerRef={analyzerRef}
              nodeIPs={nodeIPs}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ISISImpact;
