import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { WatchlistScreen } from '../screens/WatchlistScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { CustomerDetailScreen } from '../screens/CustomerDetailScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Tab Icons
const TabIcon = ({ name, focused }: { name: string; focused: boolean }) => {
  const icons: Record<string, string> = {
    Home: '🏠',
    Watchlist: '⭐',
    Notifications: '🔔',
  };

  return (
    <View style={styles.tabIconContainer}>
      <Text style={[styles.tabIcon, focused && styles.tabIconFocused]}>
        {icons[name] || '📱'}
      </Text>
    </View>
  );
};

// Main Tab Navigator
const MainTabs = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: {
          backgroundColor: '#1e293b',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: '600',
        },
        tabBarStyle: {
          backgroundColor: '#1e293b',
          borderTopColor: '#334155',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#64748b',
        tabBarIcon: ({ focused }) => (
          <TabIcon name={route.name} focused={focused} />
        ),
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Dashboard',
          headerTitle: 'Nexus Mobile',
        }}
      />
      <Tab.Screen
        name="Watchlist"
        component={WatchlistScreen}
        options={{
          title: 'Watchlist',
        }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          title: 'Alerts',
        }}
      />
    </Tab.Navigator>
  );
};

// Auth Stack Navigator
const AuthStack = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
};

// Main App Stack Navigator
const AppStack = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: '#1e293b',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: '600',
        },
        headerBackTitleVisible: false,
      }}
    >
      <Stack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerDetail"
        component={CustomerDetailScreen}
        options={{
          title: 'Customer Details',
        }}
      />
    </Stack.Navigator>
  );
};

// Root Navigator
export const AppNavigator = () => {
  const { state } = useAuth();

  if (state.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return state.userToken ? <AppStack /> : <AuthStack />;
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 20,
    opacity: 0.6,
  },
  tabIconFocused: {
    opacity: 1,
  },
});

