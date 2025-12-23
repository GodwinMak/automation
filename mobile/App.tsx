import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { AuthProvider } from './src/context/AuthContext';
import { AppNavigator } from './src/navigation/AppNavigator';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Navigation theme
const navigationTheme = {
  dark: true,
  colors: {
    primary: '#6366f1',
    background: '#0f172a',
    card: '#1e293b',
    text: '#fff',
    border: '#334155',
    notification: '#ef4444',
  },
};

export default function App() {
  useEffect(() => {
    // Request notification permissions
    registerForPushNotificationsAsync();

    // Handle notifications received while app is foregrounded
    const notificationListener = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('Notification received:', notification);
      }
    );

    // Handle notification taps
    const responseListener =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log('Notification tapped:', response);
        // Navigate to relevant screen based on notification data
      });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener);
      Notifications.removeNotificationSubscription(responseListener);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={navigationTheme}>
          <StatusBar style="light" />
          <AppNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6366f1',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notifications!');
    return;
  }

  // Get the token that uniquely identifies this device
  token = (await Notifications.getExpoPushTokenAsync()).data;
  console.log('Push token:', token);

  return token;
}

