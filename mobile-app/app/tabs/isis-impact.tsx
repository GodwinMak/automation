// app/isis/traffic-alerts.tsx

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T, AUTO_REFRESH_INTERVAL } from "@/componets/Constants";
import { ISISImpactAnalyzer } from "@/componets/GraphEngine";
import { fetchWithRetry, getErrorMessage } from "@/componets/api";
import { ISISTrafficAlertsMobile } from "@/componets/ISISTrafficAlerts";
import type { ImpactDataResponse, DownLink } from "@/componets/isis";

export default function TrafficAlertsScreen() {
  // State for topology data
  const [allEdges, setAllEdges] = useState<any[]>([]);
  const [downLinks, setDownLinks] = useState<DownLink[]>([]);
  const [nodeIPs, setNodeIPs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref for the analyzer instance
  const analyzerRef = useRef<ISISImpactAnalyzer | null>(null);

  // Fetch topology data from API
  const fetchTopology = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchWithRetry(3, 1000);

      // Update state with fetched data
      setAllEdges(data.allEdges || []);
      setDownLinks(data.downLinks || []);
      setNodeIPs(data.nodeIPs || {});

      // Create analyzer instance with the fetched data
      analyzerRef.current = new ISISImpactAnalyzer(
        data.allEdges || [],
        data.downLinks || []
      );

    } catch (err) {
      const errorMsg = getErrorMessage(err);
      setError(errorMsg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch on mount
 useEffect(() => {
    fetchTopology();
    const iv = setInterval(fetchTopology, 3 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchTopology]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTopology();
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchTopology]);

  // Pull-to-refresh handler
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchTopology();
  }, [fetchTopology]);

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ActivityIndicator color={T.blue} size="large" />
          <Text
            style={{
              marginTop: 12,
              color: T.text3,
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            Loading topology 1...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error && !analyzerRef.current) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 20,
          }}
        >
          <Text
            style={{
              fontSize: 24,
              marginBottom: 12,
            }}
          >
            ⚠️
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: T.red,
              fontFamily: "monospace",
              fontWeight: "600",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            Connection Error
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: T.text3,
              fontFamily: "monospace",
              marginBottom: 20,
              textAlign: "center",
            }}
          >
            {error}
          </Text>
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              backgroundColor: T.blue3,
              borderRadius: 6,
            }}
          >
            <Text
              onPress={onRefresh}
              style={{
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              {refreshing ? "Retrying..." : "Retry"}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Main content
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.blue}
          />
        }
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <ISISTrafficAlertsMobile
          analyzerRef={analyzerRef}
          downLinks={downLinks}
          loading={loading}
        />
      </ScrollView>

      {/* Error banner (if error but analyzer exists, retry succeeded) */}
      {error && analyzerRef.current && (
        <View
          style={{
            backgroundColor: "rgba(255, 179, 71, 0.1)",
            borderTopWidth: 1,
            borderTopColor: T.amber,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              color: T.amber,
              fontFamily: "monospace",
              fontWeight: "600",
            }}
          >
            ⚠ Last refresh failed: {error}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
