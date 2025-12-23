import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { View, Text } from "react-native";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#64748b",
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: "#1e293b",
          borderTopWidth: 1,
          borderTopColor: "#334155",
          height: 70,
          paddingBottom: 10,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          tabBarLabel: "Dashboard",
          tabBarIcon: ({ color, focused }) => (
            <View className="items-center">
              <Ionicons 
                name={focused ? "home" : "home-outline"} 
                size={22} 
                color={color} 
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          tabBarLabel: "Watchlist",
          tabBarIcon: ({ color, focused }) => (
            <View className="items-center">
              <Ionicons 
                name={focused ? "star" : "star-outline"} 
                size={22} 
                color={color} 
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <View className="items-center">
              <Ionicons 
                name={focused ? "person" : "person-outline"} 
                size={22} 
                color={color} 
              />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}