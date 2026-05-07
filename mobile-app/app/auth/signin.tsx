import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from 'expo-secure-store';
import { useAuth } from "@/context/AuthContext";
import { router } from "expo-router";
import { loginToZabbix } from "@/utils/zabbixApi";
import ZabbixPasswordModal from "@/componets/ZabbixPasswordModal";

export default function SignIN() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showZabbixModal, setShowZabbixModal] = useState(false);
  const [zabbixLoading, setZabbixLoading] = useState(false);
  const { signIn } = useAuth();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter username and password");
      return;
    }

    setLoading(true);
    try {
      // Step 1: Sign in to app
      await signIn(email, password);
      
      // Step 2: After successful login, show Zabbix password modal
      setShowZabbixModal(true);
    } catch (error: any) {
      Alert.alert("Login Failed", error.message);
      setLoading(false);
    }
  };

  const handleZabbixPassword = async (zabbixPassword: string) => {
    setZabbixLoading(true);
    try {
      // Step 3: Store Zabbix password
      await SecureStore.setItemAsync("zabbixPassword", zabbixPassword);
      
      // Step 4: Login to Zabbix
      const zabbixAuth = await loginToZabbix(email, zabbixPassword);
      
      if (!zabbixAuth) {
        throw new Error("Failed to authenticate with Zabbix");
      }

      // Step 5: Navigate to home
      setShowZabbixModal(false);
      setLoading(false);
      router.replace("/tabs/home");
    } catch (error: any) {
      Alert.alert("Zabbix Error", error.message || "Failed to authenticate with Zabbix");
      setZabbixLoading(false);
      setShowZabbixModal(false);
      setLoading(false);
    }
  };

  const handleZabbixCancel = () => {
    setShowZabbixModal(false);
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-slate-900"
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1 justify-center p-6">
            {/* Header */}
            <View className="items-center mb-12">
              <View className="w-20 h-20 rounded-2xl bg-pink-500 justify-center items-center mb-4 shadow-lg">
                <Text className="text-4xl font-bold text-white">Q</Text>
              </View>

              <Text className="text-2xl font-bold text-white mb-2">Monitoring App</Text>
              <Text className="text-base text-slate-400">
                Network monitoring at your fingertips.
              </Text>
            </View>

            {/* Form */}
            <View className="bg-slate-800 rounded-2xl p-6 shadow-lg">
              {/* Username */}
              <View className="mb-5">
                <Text className="text-sm font-semibold text-slate-200 mb-2">
                  Username
                </Text>
                <TextInput
                  className="bg-slate-700 rounded-xl px-4 py-4 text-white text-base border border-slate-600"
                  placeholder="Enter your username"
                  placeholderTextColor="#6b7280"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  returnKeyType="next"
                  editable={!loading}
                />
              </View>

              {/* Password */}
              <View className="mb-5">
                <Text className="text-sm font-semibold text-slate-200 mb-2">
                  Password
                </Text>
                <View className="flex-row items-center bg-slate-700 rounded-xl border border-slate-600">
                  <TextInput
                    className="flex-1 px-4 py-4 text-white text-base"
                    placeholder="Enter your password"
                    placeholderTextColor="#6b7280"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
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

              {/* Button */}
              <TouchableOpacity
                onPress={handleLogin}
                disabled={loading}
                className={`bg-pink-500 rounded-xl py-4 items-center mt-2 ${
                  loading ? "opacity-70" : ""
                }`}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white text-lg font-semibold">Sign In</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Footer */}
            <Text className="text-center text-slate-500 mt-12 text-xs">
              Liquid Telecom Tanzania © 2025
            </Text>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>

      {/* Zabbix Password Modal */}
      <ZabbixPasswordModal
        visible={showZabbixModal}
        loading={zabbixLoading}
        onSubmit={handleZabbixPassword}
        onCancel={handleZabbixCancel}
      />
    </KeyboardAvoidingView>
  );
}