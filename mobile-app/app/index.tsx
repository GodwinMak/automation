import {
  Image,
  ScrollView,
  Text,
  View,
  ActivityIndicator,
  // StatusBar
} from "react-native";
import React,{useState, useEffect} from "react";
import { Redirect, router, Link } from "expo-router";
import { useAuth } from '@/context/AuthContext';
import * as Network from "expo-network";
import { SafeAreaView } from 'react-native-safe-area-context';
import CustomButton from "@/componets/CustomButton";

export default function Index() {
  const [isConnected, setIsConnected] = useState(null);
  const { state } = useAuth();


  // ✅ Check internet status when screen loads
  useEffect(() => {
    const checkConnection = async () => {
      const networkState = await Network.getNetworkStateAsync();
      const connected =
        networkState.isConnected === true && networkState.isInternetReachable === true;
      setIsConnected(connected as any as null);
    };

    checkConnection();

    // Optional: Keep checking every few seconds
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  // ✅ Show "No internet" screen if offline
  if (isConnected === false) {
    return (
      <SafeAreaView className="h-full flex justify-center items-center">
        <Text style={{ color: "red", fontSize: 18, fontWeight: "bold" }}>
          ❌ No Internet Connection
        </Text>
      </SafeAreaView>
    );
  }

  if (state.isLoading) {
    return (
      <ActivityIndicator
        size={"large"}
        color="#161622"
        style={{ marginTop: "70%" }}
      />
    );
  }

  if (state.userToken !== null) return <Redirect href="/tabs/home" />;

  return (
    <SafeAreaView className="flex-1">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="w-full justify-center items-center flex-1 px-4">
          {/* <Image source={images.logo} className="w-[200px] h-[94px] mb-10" /> */}
          <View className="relative -mt-4">
            <Text className="text-2xl text-black font-bold text-center">
              CUSTOMER RELATION PORTAL <Text className="text-blue-900">CRP</Text>
            </Text>
          </View>
          <CustomButton
            title="Continue with Email"
            handlePress={() => router.push("/auth/signin")}
            containerStyles="w-full mt-7 bg-blue-900 p-3"
            textStyles="text-white"
            isLoading={false}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
