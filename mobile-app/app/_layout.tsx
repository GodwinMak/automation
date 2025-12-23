import "@/global.css"
import { AuthProvider } from "@/context/AuthContext";
import { Stack, SplashScreen } from "expo-router";
import React, { useContext, useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";


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
