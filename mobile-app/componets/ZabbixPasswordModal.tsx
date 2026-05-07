import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ZabbixPasswordModalProps {
  visible: boolean;
  loading?: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export default function ZabbixPasswordModal({
  visible,
  loading = false,
  onSubmit,
  onCancel,
}: ZabbixPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = () => {
    if (password.trim()) {
      onSubmit(password);
      setPassword(""); // Clear for next time
    } else {
      alert("Password cannot be empty");
    }
  };

  const handleCancel = () => {
    setPassword("");
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      {/* Dark overlay */}
      <View className="flex-1 bg-black bg-opacity-50 justify-center items-center px-4">
        {/* Modal Container */}
        <View className="bg-slate-800 rounded-2xl w-full p-6 shadow-lg">
          {/* Header */}
          <Text className="text-xl font-bold text-white mb-2">
            Zabbix Password
          </Text>
          <Text className="text-sm text-slate-400 mb-6">
            Enter your Zabbix password (required for monitoring integration)
          </Text>

          {/* Password Input */}
          <View className="mb-6">
            <View className="flex-row items-center bg-slate-700 rounded-xl border border-slate-600">
              <TextInput
                className="flex-1 px-4 py-4 text-white text-base"
                placeholder="Enter Zabbix password"
                placeholderTextColor="#6b7280"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                editable={!loading}
              />
              <TouchableOpacity
                className="px-4 py-4"
                onPress={() => setShowPassword(!showPassword)}
                disabled={loading}
              >
                <Ionicons
                  name={showPassword ? "eye-off" : "eye"}
                  size={22}
                  color="#6b7280"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Buttons */}
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={handleCancel}
              disabled={loading}
              className={`flex-1 bg-slate-700 rounded-xl py-3 items-center ${
                loading ? "opacity-70" : ""
              }`}
            >
              <Text className="text-white font-semibold">Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading}
              className={`flex-1 bg-pink-500 rounded-xl py-3 items-center ${
                loading ? "opacity-70" : ""
              }`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-semibold">OK</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}