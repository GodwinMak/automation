import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Linking,
  Modal,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, Stack, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import api from "@/utils/api";
import {
  fetchCustomerGraph,
  fetchGraphHistory,
  calcStats,
  formatBytes,
  getZabbixAuth,
} from "@/utils/zabbixApi";
import { LineChart } from "react-native-chart-kit";

interface CustomerData {
  id: string;
  interface: string;
  customerName: string;
  cid: string;
  nbr: string;
  port?: string;
  upmbps?: number;
  downmbps?: number;
  capacity?: number;
  // Nested customer status objects
  diacustomer?: {
    operationalStatus: string;
    adminStatus: string;
    switchName: string;
    description: string;
  };
  iptcustomer?: {
    operationalStatus: string;
    adminStatus: string;
    switchName: string;
    description: string;
  };
  sharedcustomer?: {
    operationalStatus: string;
    adminStatus: string;
    switchName: string;
    description: string;
  };
  client_db?: {
    email_address?: string;
    phone_number?: string;
    customer_name_pastel?: string;
    area?: string;
    provider?: string;
    special_comments?: string;
  };
}

// Helper to extract status info from nested structure
const getCustomerStatus = (data: CustomerData | null, type: string) => {
  if (!data) return { operationalStatus: "unknown", switchName: "N/A" };
  
  if (type === "DIA" && data.diacustomer) {
    return data.diacustomer;
  } else if (type === "IPT" && data.iptcustomer) {
    return data.iptcustomer;
  } else if (type === "Shared" && data.sharedcustomer) {
    return data.sharedcustomer;
  }
  
  return { operationalStatus: "unknown", switchName: "N/A" };
};

// Helper to get bandwidth
const getBandwidth = (data: CustomerData | null) => {
  if (!data) return "N/A";
  if (data.upmbps) return `${data.upmbps} Mbps`;
  if (data.downmbps) return `${data.downmbps} Mbps`;
  if (data.capacity) return `${data.capacity} Mbps`;
  return "N/A";
};

const screenWidth = Dimensions.get("window").width;

export default function CustomerDetailScreen() {
  const params = useLocalSearchParams();
  const { id, customerType, customerName, interface: intf, cid, nbr } = params;

  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [watchlistId, setWatchlistId] = useState<string | null>(null);

  // Graph states
  const [graphLoading, setGraphLoading] = useState(false);
  const [showGraphModal, setShowGraphModal] = useState(false);
  const [graphData, setGraphData] = useState<any>(null);
  const [graphStats, setGraphStats] = useState<any>(null);
  const [selectedRange, setSelectedRange] = useState("6h");
  const [graphItems, setGraphItems] = useState<any[]>([]);
  const [graphUnit, setGraphUnit] = useState<{ unit: string; divisor: number }>({ unit: "bps", divisor: 1 });

  // Helper to determine the best unit scale based on max value
  const getUnitScale = (maxValue: number): { unit: string; divisor: number } => {
    if (maxValue >= 1e9) {
      return { unit: "Gbps", divisor: 1e9 };
    } else if (maxValue >= 1e6) {
      return { unit: "Mbps", divisor: 1e6 };
    } else if (maxValue >= 1e3) {
      return { unit: "Kbps", divisor: 1e3 };
    }
    return { unit: "bps", divisor: 1 };
  };

  useEffect(() => {
    fetchCustomerDetails();
    checkWatchlistStatus();
  }, []);

  const fetchCustomerDetails = async () => {
    try {
      let endpoint = "";
      switch (customerType) {
        case "DIA":
          endpoint = `/customers/${id}`;
          break;
        case "IPT":
          endpoint = `/iptcustomers/${id}`;
          break;
        case "Shared":
          endpoint = `/sharedcustomers/${id}`;
          break;
        default:
          throw new Error("Unknown customer type");
      }

      const res = await api.get(endpoint);
      setCustomerData(res.data);
    } catch (error) {
      console.error("Error fetching customer details:", error);
      // Use params as fallback - create minimal data with unknown status
      const fallbackData: CustomerData = {
        id: id as string,
        interface: intf as string,
        customerName: customerName as string,
        cid: cid as string,
        nbr: nbr as string,
      };
      
      // Add the appropriate nested status object based on customerType
      if (customerType === "DIA") {
        fallbackData.diacustomer = { operationalStatus: "unknown", adminStatus: "unknown", switchName: "N/A", description: "" };
      } else if (customerType === "IPT") {
        fallbackData.iptcustomer = { operationalStatus: "unknown", adminStatus: "unknown", switchName: "N/A", description: "" };
      } else if (customerType === "Shared") {
        fallbackData.sharedcustomer = { operationalStatus: "unknown", adminStatus: "unknown", switchName: "N/A", description: "" };
      }
      
      setCustomerData(fallbackData);
    } finally {
      setLoading(false);
    }
  };

  const checkWatchlistStatus = async () => {
    try {
      const res = await api.get("/favorites");
      const favorites = res.data.favorites || [];
      const found = favorites.find(
        (f: any) => f.customerId === id && f.customerType === customerType
      );
      if (found) {
        setIsInWatchlist(true);
        setWatchlistId(found.id);
      }
    } catch (error) {
      console.error("Error checking watchlist:", error);
    }
  };

  const toggleWatchlist = async () => {
    try {
      if (isInWatchlist && watchlistId) {
        await api.delete(`/favorites/${watchlistId}`);
        setIsInWatchlist(false);
        setWatchlistId(null);
        Alert.alert("Success", "Removed from watchlist");
      } else {
        // Get the correct status from nested structure
        const statusInfo = getCustomerStatus(customerData, customerType as string);
        const res = await api.post("/favorites", {
          customerId: id,
          customerType,
          customerName: customerData?.customerName || customerName,
          interface: customerData?.interface || intf,
          cid: customerData?.cid || cid,
          nbr: customerData?.nbr || nbr,
          currentStatus: statusInfo.operationalStatus || "unknown",
        });
        setIsInWatchlist(true);
        setWatchlistId(res.data.favorite?.id);
        Alert.alert("Success", "Added to watchlist");
      }
    } catch (error: any) {
      Alert.alert(
        "Error",
        error.response?.data?.message || "Failed to update watchlist"
      );
    }
  };

  const handleCall = (phoneNumber: string) => {
    Linking.openURL(`tel:${phoneNumber}`);
  };

  const handleEmail = (email: string) => {
    Linking.openURL(`mailto:${email}`);
  };

  const handleFetchGraph = async () => {
    try {
      // Check if Zabbix is authenticated
      const auth = await getZabbixAuth();
      if (!auth) {
        Alert.alert("Error", "Zabbix not authenticated. Please login again.");
        return;
      }

      setGraphLoading(true);
      const customerStatus = getCustomerStatus(customerData, customerType as string);
      const switchName = customerStatus.switchName;
      const interfaceName = customerData?.interface || (intf as string);

      if (!switchName || switchName === "N/A") {
        Alert.alert("Error", "Switch name not available for this customer");
        setGraphLoading(false);
        return;
      }

      // Fetch graph items
      const { items } = await fetchCustomerGraph(switchName, interfaceName);
      setGraphItems(items);

      // Fetch history data
      const itemids = items.map((i: any) => i.itemid);
      await fetchAndProcessHistory(itemids, selectedRange);

      setShowGraphModal(true);
    } catch (error: any) {
      console.error("Graph fetch error:", error);
      Alert.alert("Error", error.message || "Failed to fetch graph data");
    } finally {
      setGraphLoading(false);
    }
  };

  const fetchAndProcessHistory = async (itemids: string[], range: string) => {
    try {
      const history = await fetchGraphHistory(itemids, range);

      if (!history || history.length === 0) {
        setGraphData(null);
        setGraphStats(null);
        return;
      }

      // Separate input and output data (raw values in bps)
      const inputDataRaw: number[] = [];
      const outputDataRaw: number[] = [];
      const labels: string[] = [];

      // Group by timestamp and separate by item
      const grouped: Record<string, { input?: number; output?: number }> = {};

      history.forEach((h: any) => {
        const time = new Date(h.clock * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        if (!grouped[time]) grouped[time] = {};

        const item = graphItems.find((i) => i.itemid === h.itemid);
        const value = parseFloat(h.value);

        if (item?.name?.toLowerCase().includes("in")) {
          grouped[time].input = value;
        } else {
          grouped[time].output = value;
        }
      });

      // Convert to arrays (limit data points for mobile)
      const sortedTimes = Object.keys(grouped).slice(-30);
      sortedTimes.forEach((time) => {
        labels.push(time);
        inputDataRaw.push(grouped[time].input || 0);
        outputDataRaw.push(grouped[time].output || 0);
      });

      // Calculate stats (using raw values)
      const inStats = calcStats(inputDataRaw);
      const outStats = calcStats(outputDataRaw);

      // Determine the best unit scale based on the max value across both datasets
      const maxValue = Math.max(
        ...inputDataRaw,
        ...outputDataRaw,
        inStats.max,
        outStats.max
      );
      const unitScale = getUnitScale(maxValue);
      setGraphUnit(unitScale);

      // Scale the data for display
      const inputDataScaled = inputDataRaw.map((v) => v / unitScale.divisor);
      const outputDataScaled = outputDataRaw.map((v) => v / unitScale.divisor);

      setGraphStats({ input: inStats, output: outStats });
      setGraphData({
        labels: labels.length > 6 ? labels.filter((_, i) => i % Math.ceil(labels.length / 6) === 0) : labels,
        datasets: [
          {
            data: inputDataScaled.length > 0 ? inputDataScaled : [0],
            color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
            strokeWidth: 2,
          },
          {
            data: outputDataScaled.length > 0 ? outputDataScaled : [0],
            color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
            strokeWidth: 2,
          },
        ],
        legend: ["Input", "Output"],
      });
    } catch (error) {
      console.error("History fetch error:", error);
    }
  };

  const handleRangeChange = async (range: string) => {
    setSelectedRange(range);
    if (graphItems.length > 0) {
      setGraphLoading(true);
      const itemids = graphItems.map((i) => i.itemid);
      await fetchAndProcessHistory(itemids, range);
      setGraphLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "up":
        return { bg: "bg-green-500", text: "text-green-500" };
      case "down":
        return { bg: "bg-red-500", text: "text-red-500" };
      default:
        return { bg: "bg-yellow-500", text: "text-yellow-500" };
    }
  };

  if (loading) {
    return (
      <View className="flex-1 bg-slate-900 justify-center items-center">
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  const data = customerData;
  const customerStatus = getCustomerStatus(data, customerType as string);
  const statusColors = getStatusColor(customerStatus.operationalStatus || "");
  const bandwidth = getBandwidth(data);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView className="flex-1 bg-slate-900">
        {/* Custom Header */}
        <View className="flex-row items-center px-4 py-3 bg-slate-800 border-b border-slate-700">
          <TouchableOpacity 
            onPress={() => router.back()} 
            className="p-2 -ml-2 rounded-full"
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text className="flex-1 text-white text-lg font-semibold ml-2">
            Customer Details
          </Text>
        </View>
        
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* Status Header */}
          <View className="flex-row items-center mb-2">
            <View className={`w-3 h-3 rounded-full mr-2 ${statusColors.bg}`} />
            <Text className={`text-sm font-bold flex-1 ${statusColors.text}`}>
              {customerStatus.operationalStatus?.toUpperCase() || "UNKNOWN"}
            </Text>
            <View className="bg-indigo-500 px-3 py-1 rounded-lg">
              <Text className="text-white text-xs font-semibold">
                {customerType}
              </Text>
            </View>
          </View>

          {/* Customer Name */}
          <Text className="text-2xl font-bold text-white mb-4">
            {data?.customerName || customerName}
          </Text>

          {/* Action Buttons */}
          <View className="flex-row gap-3 mb-6">
            {/* Watchlist Button */}
            <TouchableOpacity
              className={`flex-1 rounded-xl py-4 items-center ${
                isInWatchlist
                  ? "bg-indigo-500"
                  : "bg-slate-800 border border-slate-700"
              }`}
              onPress={toggleWatchlist}
            >
              <View className="flex-row items-center">
                <Ionicons
                  name={isInWatchlist ? "star" : "star-outline"}
                  size={20}
                  color={isInWatchlist ? "#fff" : "#94a3b8"}
                />
                <Text
                  className={`ml-2 font-semibold ${
                    isInWatchlist ? "text-white" : "text-slate-400"
                  }`}
                >
                  {isInWatchlist ? "Watchlist" : "Add"}
                </Text>
              </View>
            </TouchableOpacity>

            {/* View Graph Button */}
            <TouchableOpacity
              className="flex-1 rounded-xl py-4 items-center bg-green-600"
              onPress={handleFetchGraph}
              disabled={graphLoading}
            >
              <View className="flex-row items-center">
                {graphLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="stats-chart" size={20} color="#fff" />
                    <Text className="ml-2 font-semibold text-white">
                      View Graph
                    </Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          </View>

          {/* Customer Info Card */}
          <View className="bg-slate-800 rounded-2xl p-5 mb-4">
            <Text className="text-white font-semibold mb-4 pb-3 border-b border-slate-700">
              Customer Information
            </Text>

            <View className="flex-row justify-between py-3 border-b border-slate-700">
              <Text className="text-slate-500">Interface</Text>
              <Text className="text-slate-200 font-medium">
                {data?.interface || intf || "N/A"}
              </Text>
            </View>

            <View className="flex-row justify-between py-3 border-b border-slate-700">
              <Text className="text-slate-500">CID</Text>
              <Text className="text-slate-200 font-medium">
                {data?.cid || cid || "N/A"}
              </Text>
            </View>

            <View className="flex-row justify-between py-3 border-b border-slate-700">
              <Text className="text-slate-500">NBR</Text>
              <Text className="text-slate-200 font-medium flex-1 text-right ml-4" numberOfLines={1}>
                {data?.nbr || nbr || "N/A"}
              </Text>
            </View>

            <View className="flex-row justify-between py-3 border-b border-slate-700">
              <Text className="text-slate-500">Switch</Text>
              <Text className="text-slate-200 font-medium">
                {customerStatus.switchName || "N/A"}
              </Text>
            </View>

            <View className="flex-row justify-between py-3">
              <Text className="text-slate-500">Bandwidth</Text>
              <Text className="text-slate-200 font-medium">
                {bandwidth}
              </Text>
            </View>
          </View>

          {/* Contact Info Card */}
          {data?.client_db && (
            <View className="bg-slate-800 rounded-2xl p-5 mb-4">
              <Text className="text-white font-semibold mb-4 pb-3 border-b border-slate-700">
                Contact Information
              </Text>

              {data.client_db.email_address && (
                <TouchableOpacity
                  className="flex-row justify-between py-3 border-b border-slate-700"
                  onPress={() => handleEmail(data.client_db!.email_address!)}
                >
                  <Text className="text-slate-500">Email</Text>
                  <Text className="text-indigo-400 font-medium">
                    {data.client_db.email_address}
                  </Text>
                </TouchableOpacity>
              )}

              {data.client_db.phone_number && (
                <TouchableOpacity
                  className="flex-row justify-between py-3 border-b border-slate-700"
                  onPress={() => handleCall(data.client_db!.phone_number!)}
                >
                  <Text className="text-slate-500">Phone</Text>
                  <Text className="text-indigo-400 font-medium">
                    {data.client_db.phone_number}
                  </Text>
                </TouchableOpacity>
              )}

              {data.client_db.area && (
                <View className="flex-row justify-between py-3 border-b border-slate-700">
                  <Text className="text-slate-500">Area</Text>
                  <Text className="text-slate-200 font-medium">
                    {data.client_db.area}
                  </Text>
                </View>
              )}

              {data.client_db.provider && (
                <View className="flex-row justify-between py-3 border-b border-slate-700">
                  <Text className="text-slate-500">Provider</Text>
                  <Text className="text-slate-200 font-medium">
                    {data.client_db.provider}
                  </Text>
                </View>
              )}

              {data.client_db.special_comments && (
                <View className="pt-3">
                  <Text className="text-slate-500 mb-2">Special Comments</Text>
                  <Text className="text-slate-300 leading-5">
                    {data.client_db.special_comments}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Quick Actions */}
          {data?.client_db && (data.client_db.phone_number || data.client_db.email_address) && (
            <View className="bg-slate-800 rounded-2xl p-5 mb-4">
              <Text className="text-white font-semibold mb-4 pb-3 border-b border-slate-700">
                Quick Actions
              </Text>

              <View className="flex-row gap-3">
                {data.client_db.phone_number && (
                  <TouchableOpacity
                    className="flex-1 bg-green-500/20 rounded-xl py-4 items-center"
                    onPress={() => handleCall(data.client_db!.phone_number!)}
                  >
                    <Ionicons name="call" size={24} color="#22c55e" />
                    <Text className="text-green-500 mt-2 font-semibold">Call</Text>
                  </TouchableOpacity>
                )}

                {data.client_db.email_address && (
                  <TouchableOpacity
                    className="flex-1 bg-blue-500/20 rounded-xl py-4 items-center"
                    onPress={() => handleEmail(data.client_db!.email_address!)}
                  >
                    <Ionicons name="mail" size={24} color="#3b82f6" />
                    <Text className="text-blue-500 mt-2 font-semibold">Email</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Graph Modal */}
        <Modal
          visible={showGraphModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowGraphModal(false)}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-slate-800 rounded-t-3xl p-4 max-h-[85%]">
              {/* Modal Header */}
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-xl font-bold text-white">Traffic Graph</Text>
                <TouchableOpacity onPress={() => setShowGraphModal(false)}>
                  <Ionicons name="close" size={24} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {/* Range Selector */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
                <View className="flex-row gap-2">
                  {["1h", "6h", "12h", "24h", "168h", "720h"].map((range) => (
                    <TouchableOpacity
                      key={range}
                      className={`px-4 py-2 rounded-lg ${
                        selectedRange === range ? "bg-indigo-500" : "bg-slate-700"
                      }`}
                      onPress={() => handleRangeChange(range)}
                    >
                      <Text className="text-white font-medium">
                        {range === "168h" ? "7d" : range === "720h" ? "30d" : range}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* Graph */}
              {graphLoading ? (
                <View className="h-64 justify-center items-center">
                  <ActivityIndicator size="large" color="#6366f1" />
                  <Text className="text-slate-400 mt-2">Loading graph data...</Text>
                </View>
              ) : graphData ? (
                <ScrollView>
                  <View className="bg-slate-900 rounded-xl p-2 mb-4">
                    <LineChart
                      data={graphData}
                      width={screenWidth - 48}
                      height={220}
                      yAxisSuffix={` ${graphUnit.unit}`}
                      chartConfig={{
                        backgroundColor: "#1e293b",
                        backgroundGradientFrom: "#1e293b",
                        backgroundGradientTo: "#0f172a",
                        decimalPlaces: graphUnit.divisor >= 1e6 ? 2 : 0,
                        color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
                        labelColor: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`,
                        style: {
                          borderRadius: 16,
                        },
                        propsForDots: {
                          r: "3",
                          strokeWidth: "1",
                        },
                      }}
                      bezier
                      style={{
                        borderRadius: 16,
                      }}
                      formatYLabel={(value) => parseFloat(value).toFixed(graphUnit.divisor >= 1e6 ? 1 : 0)}
                    />
                  </View>

                  {/* Unit Scale Indicator */}
                  <View className="items-center mb-2">
                    <View className="bg-indigo-500/20 px-3 py-1 rounded-full">
                      <Text className="text-indigo-400 text-xs font-medium">
                        Scale: {graphUnit.unit}
                      </Text>
                    </View>
                  </View>

                  {/* Legend */}
                  <View className="flex-row justify-center gap-6 mb-4">
                    <View className="flex-row items-center">
                      <View className="w-3 h-3 rounded-full bg-green-500 mr-2" />
                      <Text className="text-slate-300">Input</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View className="w-3 h-3 rounded-full bg-blue-500 mr-2" />
                      <Text className="text-slate-300">Output</Text>
                    </View>
                  </View>

                  {/* Stats */}
                  {graphStats && (
                    <View className="bg-slate-900 rounded-xl p-4">
                      <Text className="text-white font-semibold mb-3">Statistics</Text>
                      
                      {/* Input Stats */}
                      <View className="mb-4">
                        <Text className="text-green-500 font-medium mb-2">Input Traffic</Text>
                        <View className="flex-row flex-wrap gap-2">
                          <View className="bg-slate-800 px-3 py-2 rounded-lg">
                            <Text className="text-slate-400 text-xs">Max</Text>
                            <Text className="text-white font-medium">
                              {formatBytes(graphStats.input?.max || 0)}
                            </Text>
                          </View>
                          <View className="bg-slate-800 px-3 py-2 rounded-lg">
                            <Text className="text-slate-400 text-xs">Avg</Text>
                            <Text className="text-white font-medium">
                              {formatBytes(graphStats.input?.avg || 0)}
                            </Text>
                          </View>
                          <View className="bg-slate-800 px-3 py-2 rounded-lg">
                            <Text className="text-slate-400 text-xs">95th %</Text>
                            <Text className="text-white font-medium">
                              {formatBytes(graphStats.input?.p95 || 0)}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Output Stats */}
                      <View>
                        <Text className="text-blue-500 font-medium mb-2">Output Traffic</Text>
                        <View className="flex-row flex-wrap gap-2">
                          <View className="bg-slate-800 px-3 py-2 rounded-lg">
                            <Text className="text-slate-400 text-xs">Max</Text>
                            <Text className="text-white font-medium">
                              {formatBytes(graphStats.output?.max || 0)}
                            </Text>
                          </View>
                          <View className="bg-slate-800 px-3 py-2 rounded-lg">
                            <Text className="text-slate-400 text-xs">Avg</Text>
                            <Text className="text-white font-medium">
                              {formatBytes(graphStats.output?.avg || 0)}
                            </Text>
                          </View>
                          <View className="bg-slate-800 px-3 py-2 rounded-lg">
                            <Text className="text-slate-400 text-xs">95th %</Text>
                            <Text className="text-white font-medium">
                              {formatBytes(graphStats.output?.p95 || 0)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}
                </ScrollView>
              ) : (
                <View className="h-64 justify-center items-center">
                  <Ionicons name="bar-chart-outline" size={48} color="#475569" />
                  <Text className="text-slate-500 mt-3">No graph data available</Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

