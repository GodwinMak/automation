import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import api from "@/utils/api";

interface Notification {
  id: string;
  customerName: string;
  customerType: string;
  currentStatus: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export default function ProfileScreen() {
  const { state, signOut } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Password update states
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get("/notifications?pageSize=10");
      setNotifications(res.data.notifications || []);

      const countRes = await api.get("/notifications/unread-count");
      setUnreadCount(countRes.data.unreadCount || 0);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotifications();
  }, [fetchNotifications]);

  const markAllAsRead = async () => {
    try {
      await api.put("/notifications/mark-all-read");
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (error) {
      Alert.alert("Error", "Failed to mark all as read");
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await signOut();
          // Navigate back to index page after logout
          router.replace("/");
        },
      },
    ]);
  };

  const handlePasswordUpdate = async () => {
    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert("Error", "Please fill in all password fields");
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "New password and confirmation do not match");
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert("Error", "New password must be at least 6 characters");
      return;
    }

    setPasswordLoading(true);
    try {
      await api.put(`/users/${state.userData?.id}`, {
        password: newPassword,
      });

      Alert.alert("Success", "Password updated successfully. Please login again.", [
        {
          text: "OK",
          onPress: async () => {
            setShowPasswordModal(false);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            await signOut();
            router.replace("/");
          },
        },
      ]);
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.message || "Failed to update password");
    } finally {
      setPasswordLoading(false);
    }
  };

  const resetPasswordModal = () => {
    setShowPasswordModal(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

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
        return { label: "Admin", color: "#ef4444", bg: "bg-red-500/20" };
      case "operator":
        return { label: "Operator", color: "#3b82f6", bg: "bg-blue-500/20" };
      case "customer_relation":
        return { label: "Customer Relation", color: "#22c55e", bg: "bg-green-500/20" };
      default:
        return { label: "User", color: "#6b7280", bg: "bg-gray-500/20" };
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
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
      >
        {/* Profile Card */}
        <View className="bg-slate-800 rounded-2xl p-6 mb-6">
          <View className="items-center mb-4">
            <View className="w-20 h-20 rounded-full bg-indigo-500 justify-center items-center mb-3">
              <Text className="text-3xl font-bold text-white">
                {(state.userData?.fullName || state.userData?.username || "U")
                  .charAt(0)
                  .toUpperCase()}
              </Text>
            </View>
            <Text className="text-xl font-bold text-white">
              {state.userData?.fullName || state.userData?.username}
            </Text>
            <Text className="text-slate-400 text-sm">
              @{state.userData?.username}
            </Text>
            <View className={`px-4 py-1 rounded-full mt-2 ${badge.bg}`}>
              <Text style={{ color: badge.color }} className="text-sm font-semibold">
                {badge.label}
              </Text>
            </View>
          </View>

          {/* Stats Row */}
          <View className="flex-row justify-around pt-4 border-t border-slate-700">
            <View className="items-center">
              <Text className="text-2xl font-bold text-white">{unreadCount}</Text>
              <Text className="text-slate-400 text-xs">Unread Alerts</Text>
            </View>
            <View className="items-center">
              <Text className="text-2xl font-bold text-white">{notifications.length}</Text>
              <Text className="text-slate-400 text-xs">Total Alerts</Text>
            </View>
          </View>
        </View>

        {/* Notifications Section */}
        <View className="mb-6">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-lg font-semibold text-white">Recent Notifications</Text>
            {unreadCount > 0 && (
              <TouchableOpacity onPress={markAllAsRead}>
                <Text className="text-indigo-400 text-sm font-semibold">Mark all read</Text>
              </TouchableOpacity>
            )}
          </View>

          {notifications.length === 0 ? (
            <View className="bg-slate-800 rounded-xl p-8 items-center">
              <Ionicons name="notifications-off-outline" size={48} color="#475569" />
              <Text className="text-slate-500 mt-3">No notifications yet</Text>
            </View>
          ) : (
            notifications.slice(0, 5).map((n) => (
              <View
                key={n.id}
                className={`bg-slate-800 rounded-xl p-4 mb-2 ${
                  !n.isRead ? "border-l-4 border-indigo-500" : ""
                }`}
              >
                <View className="flex-row items-center mb-2">
                  <View
                    className={`w-2 h-2 rounded-full mr-2 ${
                      n.currentStatus === "down" ? "bg-red-500" : "bg-green-500"
                    }`}
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
                <Text className="text-slate-400 text-sm mb-1" numberOfLines={2}>
                  {n.message}
                </Text>
                <Text className="text-slate-500 text-xs">{formatTime(n.createdAt)}</Text>
              </View>
            ))
          )}
        </View>

        {/* Actions */}
        <View className="mb-6">
          <Text className="text-lg font-semibold text-white mb-3">Account</Text>

          <TouchableOpacity
            className="bg-slate-800 rounded-xl p-4 flex-row items-center mb-2"
            onPress={() => setShowPasswordModal(true)}
          >
            <Ionicons name="lock-closed-outline" size={24} color="#94a3b8" />
            <Text className="text-white ml-3 flex-1">Change Password</Text>
            <Ionicons name="chevron-forward" size={20} color="#475569" />
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-slate-800 rounded-xl p-4 flex-row items-center mb-2"
            onPress={() => Alert.alert("Info", "Version 1.0.0")}
          >
            <Ionicons name="information-circle-outline" size={24} color="#94a3b8" />
            <Text className="text-white ml-3 flex-1">About App</Text>
            <Ionicons name="chevron-forward" size={20} color="#475569" />
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-red-500/10 rounded-xl p-4 flex-row items-center"
            onPress={handleLogout}
          >
            <Ionicons name="log-out-outline" size={24} color="#ef4444" />
            <Text className="text-red-500 ml-3 flex-1 font-semibold">Logout</Text>
            <Ionicons name="chevron-forward" size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text className="text-center text-slate-600 text-xs pb-8">
          Liquid Telecom Tanzania © 2025
        </Text>
      </ScrollView>

      {/* Password Update Modal */}
      <Modal
        visible={showPasswordModal}
        animationType="slide"
        transparent={true}
        onRequestClose={resetPasswordModal}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-slate-800 rounded-t-3xl p-6 max-h-[80%]">
            {/* Modal Header */}
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-xl font-bold text-white">Change Password</Text>
              <TouchableOpacity onPress={resetPasswordModal}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Current Password */}
            <View className="mb-4">
              <Text className="text-sm font-semibold text-slate-300 mb-2">
                Current Password
              </Text>
              <View className="flex-row items-center bg-slate-700 rounded-xl border border-slate-600">
                <TextInput
                  className="flex-1 px-4 py-4 text-white text-base"
                  placeholder="Enter current password"
                  placeholderTextColor="#6b7280"
                  secureTextEntry={!showCurrentPassword}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                />
                <TouchableOpacity
                  className="px-4"
                  onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                >
                  <Ionicons
                    name={showCurrentPassword ? "eye-off" : "eye"}
                    size={20}
                    color="#6b7280"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* New Password */}
            <View className="mb-4">
              <Text className="text-sm font-semibold text-slate-300 mb-2">
                New Password
              </Text>
              <View className="flex-row items-center bg-slate-700 rounded-xl border border-slate-600">
                <TextInput
                  className="flex-1 px-4 py-4 text-white text-base"
                  placeholder="Enter new password"
                  placeholderTextColor="#6b7280"
                  secureTextEntry={!showNewPassword}
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                <TouchableOpacity
                  className="px-4"
                  onPress={() => setShowNewPassword(!showNewPassword)}
                >
                  <Ionicons
                    name={showNewPassword ? "eye-off" : "eye"}
                    size={20}
                    color="#6b7280"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-slate-300 mb-2">
                Confirm New Password
              </Text>
              <View className="flex-row items-center bg-slate-700 rounded-xl border border-slate-600">
                <TextInput
                  className="flex-1 px-4 py-4 text-white text-base"
                  placeholder="Confirm new password"
                  placeholderTextColor="#6b7280"
                  secureTextEntry={!showConfirmPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
                <TouchableOpacity
                  className="px-4"
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <Ionicons
                    name={showConfirmPassword ? "eye-off" : "eye"}
                    size={20}
                    color="#6b7280"
                  />
                </TouchableOpacity>
              </View>
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <Text className="text-red-500 text-sm mt-2">
                  Passwords do not match
                </Text>
              )}
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              className={`bg-indigo-500 rounded-xl py-4 items-center ${
                passwordLoading ? "opacity-70" : ""
              }`}
              onPress={handlePasswordUpdate}
              disabled={passwordLoading}
            >
              {passwordLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-lg font-semibold">Update Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

