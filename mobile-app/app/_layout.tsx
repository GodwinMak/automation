import "@/global.css"
import { AuthProvider } from "@/context/AuthContext";
import { Stack, SplashScreen } from "expo-router";
import React, { useContext, useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Platform } from "react-native";
import Constants from "expo-constants";



export default function RootLayout() {

  // const [fontsLoaded, fontsError] = useFonts({
  //   // Add your font files here, e.g. 
  //   Inter: require("@assets/fonts/Inter.ttf"),
  //   // Add more fonts as needed
  // });

  // useEffect(() => {
  //   if (fontsError) throw fontsError;
  //   if (fontsLoaded) {
  //     SplashScreen.hideAsync();
  //   }
  // }, [fontsLoaded, fontsError]);

  // if (!fontsLoaded && !fontsError) {
  //   return null;
  // }

  useEffect(() => {
      const requestPermissions = async () => {
        if (Constants.appOwnership === "expo") {
          return;
        }
        const Notifications = await import("expo-notifications");
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#FF231F7C",
            sound: "default",
          });
        }
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") {
          // Permission denied; notifications will be skipped.
          return;
        }
      };

      requestPermissions();
    }, []);
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
          screenOptions={{
            headerShown: false,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="auth" />
          <Stack.Screen name="tabs" />
        </Stack>
    </AuthProvider>
  );
}
