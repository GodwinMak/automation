import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import api from "@/utils/api";

interface WatchlistItem {
  id: string;
  customerId: string;
  customerName: string;
  customerType: "DIA" | "IPT" | "Shared";
  interface: string;
  cid: string;
  nbr: string;
  currentStatus: string;
}

// Helper to get live status from customer data
const getLiveStatus = (data: any, customerType: string): string => {
  if (!data) return "unknown";
  
  if (customerType === "DIA" && data.diacustomer) {
    return data.diacustomer.operationalStatus || "unknown";
  } else if (customerType === "IPT" && data.iptcustomer) {
    return data.iptcustomer.operationalStatus || "unknown";
  } else if (customerType === "Shared" && data.sharedcustomer) {
    return data.sharedcustomer.operationalStatus || "unknown";
  }
  
  return data.operationalStatus || "unknown";
};

export default function WatchlistScreen() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch live status for a single customer
  const fetchLiveStatus = async (customerId: string, customerType: string): Promise<string> => {
    try {
      let endpoint = "";
      switch (customerType) {
        case "DIA":
          endpoint = `/customers/${customerId}`;
          break;
        case "IPT":
          endpoint = `/iptcustomers/${customerId}`;
          break;
        case "Shared":
          endpoint = `/sharedcustomers/${customerId}`;
          break;
        default:
          return "unknown";
      }
      
      const res = await api.get(endpoint);
      return getLiveStatus(res.data, customerType);
    } catch (error) {
      console.error(`Error fetching status for ${customerId}:`, error);
      return "unknown";
    }
  };

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await api.get("/favorites");
      const favorites = res.data.favorites || [];
      
      // Fetch live status for each customer
      const updatedFavorites = await Promise.all(
        favorites.map(async (item: WatchlistItem) => {
          const liveStatus = await fetchLiveStatus(item.customerId, item.customerType);
          return { ...item, currentStatus: liveStatus };
        })
      );
      
      setWatchlist(updatedFavorites);
    } catch (error) {
      console.error("Error fetching watchlist:", error);
      Alert.alert("Error", "Failed to load watchlist");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchWatchlist();
  }, [fetchWatchlist]);

  const handleRemoveFromWatchlist = async (favoriteId: string) => {
    Alert.alert(
      "Remove from Watchlist",
      "Are you sure you want to remove this customer from your watchlist?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await api.delete(`/favorites/${favoriteId}`);
              setWatchlist((prev) =>
                prev.filter((item) => item.id !== favoriteId)
              );
            } catch (error) {
              Alert.alert("Error", "Failed to remove from watchlist");
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "up":
        return "bg-green-500";
      case "down":
        return "bg-red-500";
      default:
        return "bg-yellow-500";
    }
  };

  const getStatusTextColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "up":
        return "text-green-500";
      case "down":
        return "text-red-500";
      default:
        return "text-yellow-500";
    }
  };

  const getTypeBgColor = (type: string) => {
    switch (type) {
      case "DIA":
        return "bg-indigo-500/20";
      case "IPT":
        return "bg-purple-500/20";
      case "Shared":
        return "bg-pink-500/20";
      default:
        return "bg-gray-500/20";
    }
  };

  const getTypeTextColor = (type: string) => {
    switch (type) {
      case "DIA":
        return "text-indigo-400";
      case "IPT":
        return "text-purple-400";
      case "Shared":
        return "text-pink-400";
      default:
        return "text-gray-400";
    }
  };

  const renderItem = ({ item }: { item: WatchlistItem }) => (
    <TouchableOpacity
      className="bg-slate-800 rounded-2xl p-4 mb-3"
      onPress={() =>
        router.push({
          pathname: "/customer/[id]",
          params: {
            id: item.customerId,
            customerType: item.customerType,
            customerName: item.customerName,
            interface: item.interface,
            cid: item.cid,
            nbr: item.nbr,
          },
        })
      }
      onLongPress={() => handleRemoveFromWatchlist(item.id)}
    >
      {/* Header */}
      <View className="flex-row items-center mb-3">
        <View className={`w-3 h-3 rounded-full mr-3 ${getStatusColor(item.currentStatus)}`} />
        <Text className="flex-1 text-lg font-semibold text-white" numberOfLines={1}>
          {item.customerName}
        </Text>
        <View className={`px-3 py-1 rounded-lg ${getTypeBgColor(item.customerType)}`}>
          <Text className={`text-xs font-semibold ${getTypeTextColor(item.customerType)}`}>
            {item.customerType}
          </Text>
        </View>
      </View>

      {/* Info */}
      <View className="border-t border-slate-700 pt-3 mb-3">
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-500 text-sm">Interface</Text>
          <Text className="text-slate-300 text-sm flex-1 text-right ml-4" numberOfLines={1}>
            {item.interface || "N/A"}
          </Text>
        </View>
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-500 text-sm">CID</Text>
          <Text className="text-slate-300 text-sm">{item.cid || "N/A"}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-slate-500 text-sm">NBR</Text>
          <Text className="text-slate-300 text-sm flex-1 text-right ml-4" numberOfLines={1}>
            {item.nbr || "N/A"}
          </Text>
        </View>
      </View>

      {/* Footer */}
      <View className="flex-row justify-between items-center">
        <View className={`px-3 py-1.5 rounded-lg ${item.currentStatus === "up" ? "bg-green-500/20" : "bg-red-500/20"}`}>
          <Text className={`text-xs font-bold ${getStatusTextColor(item.currentStatus)}`}>
            {item.currentStatus?.toUpperCase() || "UNKNOWN"}
          </Text>
        </View>
        <Text className="text-slate-600 text-[10px] italic">Long press to remove</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View className="flex-1 bg-slate-900 justify-center items-center">
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* Header */}
      <View className="px-4 py-4 border-b border-slate-800">
        <Text className="text-2xl font-bold text-white">My Watchlist</Text>
        <Text className="text-slate-400 text-sm mt-1">
          {watchlist.length} customer{watchlist.length !== 1 ? "s" : ""} being monitored
        </Text>
      </View>

      <FlatList
        data={watchlist}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListEmptyComponent={
          <View className="flex-1 justify-center items-center py-16">
            <Text className="text-6xl mb-4">⭐</Text>
            <Text className="text-lg font-semibold text-white mb-2">
              No customers in watchlist
            </Text>
            <Text className="text-slate-500 text-center px-8">
              Add customers to your watchlist to monitor them here
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

