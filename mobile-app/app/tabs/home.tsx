import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import api from "@/utils/api";
import GlobalSearchMobile from "@/componets/GlobalSearchMobile";

interface Stats {
  watchlistCount: number;
}

export default function HomeScreen() {
  const { state, signOut } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const notifRes = await api.get("/notifications?pageSize=5");
      setNotifications(notifRes.data.notifications);

      const countRes = await api.get("/notifications/unread-count");
      setUnreadCount(countRes.data.unreadCount);

      const watchlistRes = await api.get("/favorites");

      setStats({
        watchlistCount: watchlistRes.data.favorites?.length || 0,
      });
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getRoleBadge = () => {
    switch (state.userData?.role) {
      case "admin":
        return { label: "Admin", color: "#ef4444" };
      case "operator":
        return { label: "Operator", color: "#3b82f6" };
      case "customer_relation":
        return { label: "Customer Relation", color: "#22c55e" };
      default:
        return { label: "User", color: "#6b7280" };
    }
  };

  const badge = getRoleBadge();

  if (loading) {
    return (
      <View className="flex-1 bg-slate-900 justify-center items-center">
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
        }
      >
      {/* HEADER */}
      <View className="flex-row justify-between items-start mb-6">
        <View>
          <Text className="text-sm text-slate-400">Welcome back,</Text>
          <Text className="text-2xl text-white font-bold mt-1">
            {state.userData?.fullName || state.userData?.username}
          </Text>

          <View
            className="self-start px-3 py-1 rounded-xl mt-2"
            style={{ backgroundColor: badge.color + "20" }}
          >
            {/* GLOBAL SEARCH (users, DIA, IPT, Shared) */}
            <Text style={{ color: badge.color }} className="text-xs font-semibold">
              {badge.label}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          className="bg-slate-800 px-4 py-2 rounded-lg"
          onPress={() => {
            Alert.alert("Logout", "Are you sure you want to logout?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Logout",
                style: "destructive",
                onPress: async () => {
                  await signOut();
                  router.replace("/");
                },
              },
            ]);
          }}
        >
          <Text className="text-red-500 font-semibold">Logout</Text>
        </TouchableOpacity>
      </View>
      <GlobalSearchMobile />


      {/* STATS */}
      <View className="flex-row gap-3 mb-6">
        <TouchableOpacity 
          className="flex-1 bg-slate-800 rounded-2xl p-5 items-center"
          onPress={() => router.push("/tabs/list")}
        >
          <Text className="text-3xl font-bold text-indigo-500">
            {stats?.watchlistCount || 0}
          </Text>
          <Text className="text-slate-400 mt-1">Watchlist</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          className="flex-1 bg-slate-800 rounded-2xl p-5 border border-red-500 items-center"
          onPress={() => router.push("/tabs/profile")}
        >
          <Text className="text-3xl font-bold text-red-500">{unreadCount}</Text>
          <Text className="text-slate-400 mt-1">Alerts</Text>
        </TouchableOpacity>
      </View>

      {/* NOTIFICATIONS */}
      <View className="mb-6">
        <Text className="text-lg font-semibold text-white mb-3">Recent Alerts</Text>

        {notifications.length === 0 ? (
          <View className="bg-slate-800 rounded-xl p-6 items-center">
            <Text className="text-slate-500">No recent alerts</Text>
          </View>
        ) : (
          notifications.map((n: any) => (
            <TouchableOpacity
              key={n.id}
              className={`bg-slate-800 rounded-xl p-4 mb-2 ${
                !n.isRead ? "border-l-4 border-indigo-500" : ""
              }`}
              onPress={() =>
                router.push({
                  pathname: "/customer/[id]",
                  params: {
                    id: n.customerId,
                    customerType: n.customerType,
                    customerName: n.customerName,
                    interface: n.interface,
                    cid: n.cid,
                    nbr: n.nbr,
                  },
                })
              }
            >
              <View className="flex-row items-center mb-2">
                <View
                  className="w-2 h-2 rounded-full mr-2"
                  style={{ backgroundColor: n.currentStatus === "down" ? "#ef4444" : "#22c55e" }}
                />
                <Text className="flex-1 text-white font-semibold" numberOfLines={1}>
                  {n.customerName}
                </Text>

                <View className="bg-slate-700 px-2 py-1 rounded">
                  <Text className="text-[10px] text-slate-300 font-semibold">
                    {n.customerType}
                  </Text>
                </View>
              </View>

              <Text className="text-slate-400 mb-1" numberOfLines={2}>
                {n.message}
              </Text>

              <Text className="text-xs text-slate-500">{formatTime(n.createdAt)}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}
