// components/ISISTrafficAlerts.tsx

import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T, SEV_COLORS, SEV_BGS } from "./Constants";
import {
  fmtBps,
  trafficUtil,
  utilColor,
  fmtMetric,
  getSeverityColor,
  getSeverityBg,
} from "./formatters";
import { ISISImpactAnalyzer } from "./GraphEngine";
import type { TrafficAlert, FailureDetail, CurrentDownResult } from "./isis";

interface ISISTrafficAlertsProps {
  analyzerRef: React.RefObject<ISISImpactAnalyzer | null>;
  downLinks: any[];
  loading?: boolean;
}

type TabType = "traffic" | "failures";

export function ISISTrafficAlertsMobile({
  analyzerRef,
  downLinks,
  loading = false,
}: ISISTrafficAlertsProps) {
  const [activeTab, setActiveTab] = useState<TabType>("traffic");
  const [expandedLink, setExpandedLink] = useState<string | null>(null);

  if (loading || !analyzerRef.current) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={T.blue} size="large" />
          <Text style={{ marginTop: 12, color: T.text3, fontFamily: "monospace", fontSize: 12 }}>
            Loading topology...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const analyzer = analyzerRef.current;

  // Get high-traffic interfaces (>80%) – each parallel link appears separately
  const getHighTrafficLinks = () => {
    const g = analyzer?.baseGraph;
    if (!g) return [];
    const interfaces = g.getInterfaces();
    const links: TrafficAlert[] = [];

    for (const intf of interfaces) {
      const util = intf.utilPercent;
      if (util !== null && util > 80) {
        links.push({
          key: `${intf.nodeA}|${intf.nodeB}|${intf.iface}`,
          nodeA: intf.nodeA,
          nodeB: intf.nodeB,
          iface: intf.iface,
          util,
          cap: intf.capacity,
          inBps: intf.input_bps,
          outBps: intf.output_bps,
          count: 1,
        });
      }
    }
    return links.sort((a, b) => b.util - a.util);
  };

  const getFailureImpact = (): CurrentDownResult | null => {
    if (downLinks.length === 0) return null;
    return analyzer.analyzeCurrentDown() as CurrentDownResult;
  };

  // Compute unique failure count (deduplicate by unordered node pair)
  const getUniqueDownLinksCount = () => {
    const unique = new Set<string>();
    for (const link of downLinks) {
      const key = [link.a, link.b].sort().join('|');
      unique.add(key);
    }
    return unique.size;
  };

  const highTrafficLinks = getHighTrafficLinks();
  const failureResult = getFailureImpact();
  const uniqueDownCount = getUniqueDownLinksCount();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Header */}
      <View style={{ backgroundColor: T.bg2, borderBottomWidth: 1, borderBottomColor: T.border, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: T.blue, fontFamily: "monospace", letterSpacing: 0.5 }}>
          ISIS TRAFFIC ALERTS
        </Text>
        <Text style={{ fontSize: 11, color: T.text3, marginTop: 4, fontFamily: "monospace" }}>
          Links {'>'}80% util · Current failures
        </Text>
      </View>

      {/* Status Bar */}
      {downLinks.length > 0 && failureResult && (
        <View style={{ backgroundColor: getSeverityBg(failureResult.severity), borderBottomWidth: 1, borderBottomColor: getSeverityColor(failureResult.severity), paddingHorizontal: 16, paddingVertical: 12, marginHorizontal: 12, marginVertical: 8, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: getSeverityColor(failureResult.severity) }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: getSeverityColor(failureResult.severity), fontFamily: "monospace" }}>
            ● {failureResult.severity}
          </Text>
          <Text style={{ fontSize: 11, color: T.text2, marginTop: 4, fontFamily: "monospace" }}>
            {uniqueDownCount} link{uniqueDownCount > 1 ? "s" : ""} DOWN ·{" "}
            {failureResult.isolated?.length || 0} isolated node
            {failureResult.isolated?.length !== 1 ? "s" : ""}
          </Text>
        </View>
      )}

      {/* Tabs */}
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: T.border, paddingHorizontal: 12 }}>
        <TouchableOpacity onPress={() => setActiveTab("traffic")} style={{ flex: 1, paddingVertical: 12, borderBottomWidth: activeTab === "traffic" ? 2 : 0, borderBottomColor: activeTab === "traffic" ? T.blue : "transparent" }}>
          <Text style={{ fontSize: 12, fontFamily: "monospace", color: activeTab === "traffic" ? T.blue : T.text3, fontWeight: activeTab === "traffic" ? "600" : "400", textAlign: "center" }}>
            HIGH TRAFFIC ({highTrafficLinks.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveTab("failures")} style={{ flex: 1, paddingVertical: 12, borderBottomWidth: activeTab === "failures" ? 2 : 0, borderBottomColor: activeTab === "failures" ? T.blue : "transparent" }}>
          <Text style={{ fontSize: 12, fontFamily: "monospace", color: activeTab === "failures" ? T.blue : T.text3, fontWeight: activeTab === "failures" ? "600" : "400", textAlign: "center" }}>
            FAILURES ({uniqueDownCount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
        {activeTab === "traffic" && <HighTrafficView links={highTrafficLinks} />}
        {activeTab === "failures" && failureResult && (
          <FailureView
            result={failureResult}
            downLinks={downLinks}
            expandedLink={expandedLink}
            setExpandedLink={setExpandedLink}
          />
        )}
        {activeTab === "traffic" && highTrafficLinks.length === 0 && (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
            <Text style={{ fontSize: 28, marginBottom: 8 }}>✓</Text>
            <Text style={{ fontSize: 14, color: T.green, fontFamily: "monospace", fontWeight: "600" }}>All links under 80%</Text>
            <Text style={{ fontSize: 11, color: T.text3, marginTop: 8, fontFamily: "monospace" }}>Network is healthy</Text>
          </View>
        )}
        {activeTab === "failures" && downLinks.length === 0 && (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
            <Text style={{ fontSize: 28, marginBottom: 8 }}>✓</Text>
            <Text style={{ fontSize: 14, color: T.green, fontFamily: "monospace", fontWeight: "600" }}>No active failures</Text>
            <Text style={{ fontSize: 11, color: T.text3, marginTop: 8, fontFamily: "monospace" }}>All links UP</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function HighTrafficView({ links }: { links: TrafficAlert[] }) {
  return (
    <View>
      {links.map((link) => (
        <View
          key={link.key}
          style={{
            backgroundColor: "rgba(255, 90, 90, 0.06)",
            borderWidth: 1,
            borderColor: "rgba(255, 90, 90, 0.2)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 8,
            borderLeftWidth: 3,
            borderLeftColor: utilColor(link.util),
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: T.text, fontFamily: "monospace", flex: 1 }}>
              {link.nodeA} ↔ {link.nodeB}
            </Text>
            <View style={{ backgroundColor: "rgba(255, 179, 71, 0.15)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
              <Text style={{ fontSize: 10, fontWeight: "600", color: T.amber, fontFamily: "monospace" }}>{link.cap}G</Text>
            </View>
          </View>
          {link.iface && (
            <Text style={{ fontSize: 9, color: T.text3, fontFamily: "monospace", marginBottom: 6 }}>
              Interface: {link.iface}
            </Text>
          )}
          <View style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={{ fontSize: 10, color: T.text3, fontFamily: "monospace" }}>LIVE TRAFFIC</Text>
              <Text style={{ fontSize: 10, color: utilColor(link.util), fontWeight: "600", fontFamily: "monospace" }}>{link.util}%</Text>
            </View>
            <View style={{ height: 6, backgroundColor: T.bg3, borderRadius: 3, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${link.util}%`, backgroundColor: utilColor(link.util), borderRadius: 3 }} />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
              <Text style={{ fontSize: 9, color: T.text3, fontFamily: "monospace" }}>
                ↓ {fmtBps(link.inBps)} · ↑ {fmtBps(link.outBps)}
              </Text>
            </View>
          </View>
          {link.util >= 90 && (
            <View style={{ backgroundColor: "rgba(255, 90, 90, 0.1)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderLeftWidth: 2, borderLeftColor: T.red }}>
              <Text style={{ fontSize: 9, color: T.red, fontFamily: "monospace", fontWeight: "600" }}>
                ⚠ CRITICAL — Link near saturation
              </Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function FailureView({
  result,
  downLinks,
  expandedLink,
  setExpandedLink,
}: {
  result: CurrentDownResult;
  downLinks: any[];
  expandedLink: string | null;
  setExpandedLink: (link: string | null) => void;
}) {
  // Deduplicate failures by unordered node pair (ignore direction and interface)
  const uniqueMap = new Map<string, FailureDetail>();
  for (const link of result.perLink) {
    const key = [link.a, link.b].sort().join('|');
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, link);
    }
  }
  const dedupedLinks = Array.from(uniqueMap.values());

  return (
    <View>
      {dedupedLinks.map((link, idx) => {
        // Build a stable key for expansion state
        const key = link.key || `${link.a}|${link.b}|${idx}`;
        const isExpanded = expandedLink === key;
        const color = getSeverityColor(link.impact);

        return (
          <View
            key={key}
            style={{
              backgroundColor: getSeverityBg(link.impact),
              borderWidth: 1,
              borderColor: color,
              borderRadius: 8,
              marginBottom: 8,
              overflow: "hidden",
              borderLeftWidth: 3,
              borderLeftColor: color,
            }}
          >
            <TouchableOpacity
              onPress={() => setExpandedLink(isExpanded ? null : key)}
              style={{ padding: 12 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: T.text, fontFamily: "monospace" }}>
                    {link.a} ✗ {link.b}
                  </Text>
                  {link.iface && (
                    <Text style={{ fontSize: 10, color: T.text3, marginTop: 2, fontFamily: "monospace" }}>
                      Interface: {link.iface}
                    </Text>
                  )}
                  <Text style={{ fontSize: 10, color: T.text3, marginTop: 2, fontFamily: "monospace" }}>
                    {link.since} · {link.duration}
                  </Text>
                </View>
                <View style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: `rgba(${color === T.red ? "255, 90, 90" : "255, 179, 71"}, 0.15)`, borderRadius: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: color, fontFamily: "monospace", letterSpacing: 0.5 }}>
                    {link.impact}
                  </Text>
                </View>
              </View>

              {/* Quick stats */}
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {link.capLabel && (
                  <View style={{ backgroundColor: "rgba(74, 158, 255, 0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }}>
                    <Text style={{ fontSize: 9, color: T.blue, fontFamily: "monospace" }}>{link.capLabel}</Text>
                  </View>
                )}
                {link.aIsolated && (
                  <View style={{ backgroundColor: "rgba(255, 90, 90, 0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }}>
                    <Text style={{ fontSize: 9, color: T.red, fontFamily: "monospace", fontWeight: "600" }}>{link.a} isolated</Text>
                  </View>
                )}
                {link.bIsolated && (
                  <View style={{ backgroundColor: "rgba(255, 90, 90, 0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }}>
                    <Text style={{ fontSize: 9, color: T.red, fontFamily: "monospace", fontWeight: "600" }}>{link.b} isolated</Text>
                  </View>
                )}
                {link.parallelCount > 1 && (
                  <View style={{ backgroundColor: "rgba(155, 127, 255, 0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }}>
                    <Text style={{ fontSize: 9, color: T.purple, fontFamily: "monospace" }}>×{link.parallelCount} parallel</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>

            {isExpanded && (
              <View style={{ borderTopWidth: 1, borderTopColor: color, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "rgba(255, 90, 90, 0.02)" }}>
                {link.trafficUtilPct !== null && link.trafficUtilPct !== undefined && (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 10, color: T.text3, fontFamily: "monospace", fontWeight: "600", marginBottom: 4 }}>
                      TRAFFIC AT FAILURE
                    </Text>
                    <View style={{ height: 5, backgroundColor: T.bg3, borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                      <View style={{ height: "100%", width: `${link.trafficUtilPct}%`, backgroundColor: utilColor(link.trafficUtilPct), borderRadius: 3 }} />
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 9, color: utilColor(link.trafficUtilPct), fontFamily: "monospace", fontWeight: "600" }}>{link.trafficUtilPct}%</Text>
                      <Text style={{ fontSize: 9, color: T.text3, fontFamily: "monospace" }}>{fmtBps(link.edgeInputBps)} ↓ · {fmtBps(link.edgeOutputBps)} ↑</Text>
                    </View>
                  </View>
                )}
                {link.hopInflation && link.hopInflation > 0 && (
                  <View style={{ backgroundColor: "rgba(255, 179, 71, 0.1)", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, marginBottom: 8, borderLeftWidth: 2, borderLeftColor: T.amber }}>
                    <Text style={{ fontSize: 10, color: T.amber, fontFamily: "monospace", fontWeight: "600" }}>
                      Path inflation: +{link.hopInflation} hop{link.hopInflation > 1 ? "s" : ""} / +{fmtMetric(link.costInflation || 0)} metric
                    </Text>
                  </View>
                )}
                {link.linkIsolated && link.linkIsolated.length > 0 && (
                  <View style={{ backgroundColor: "rgba(255, 90, 90, 0.1)", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, borderLeftWidth: 2, borderLeftColor: T.red }}>
                    <Text style={{ fontSize: 10, color: T.red, fontFamily: "monospace", fontWeight: "600", marginBottom: 4 }}>
                      BRIDGE LINK — {link.linkIsolated.length} isolated node{link.linkIsolated.length > 1 ? "s" : ""}
                    </Text>
                    {link.linkIsolated.map((iso, i) => (
                      <Text key={i} style={{ fontSize: 9, color: T.text3, fontFamily: "monospace" }}>• {iso.node}</Text>
                    ))}
                  </View>
                )}
                {link.linkPartitioned && link.linkPartitionGroups && link.linkPartitionGroups.length > 0 && link.linkIsolated?.length === 0 && (
                  <View style={{ backgroundColor: "rgba(255, 179, 71, 0.1)", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, borderLeftWidth: 2, borderLeftColor: T.amber }}>
                    <Text style={{ fontSize: 10, color: T.amber, fontFamily: "monospace", fontWeight: "600", marginBottom: 4 }}>NETWORK PARTITIONS</Text>
                    {link.linkPartitionGroups.map((grp, gi) => (
                      <Text key={gi} style={{ fontSize: 9, color: T.text3, fontFamily: "monospace" }}>
                        Island {gi+1}: {grp.slice(0,3).join(", ")}{grp.length > 3 ? `… +${grp.length-3}` : ""}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}