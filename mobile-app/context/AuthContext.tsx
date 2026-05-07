import React, { createContext, useContext, useReducer, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from "react-native";
import api from '@/utils/api';
import Constants from "expo-constants";
import { clearZabbixAuth } from '@/utils/zabbixApi';

interface User {
  id: string;
  username: string;
  email?: string;
  fullName?: string;
  role: 'admin' | 'operator' | 'customer_relation';
}

interface AuthState {
  userToken: string | null;
  userData: User | null;
  isLoading: boolean;
  isSignout: boolean;
}

type AuthAction =
  | { type: 'RESTORE_TOKEN'; token: string | null; userData: User | null }
  | { type: 'SIGN_IN'; token: string; userData: User }
  | { type: 'SIGN_OUT' }
  | { type: 'SET_LOADING'; isLoading: boolean };

const initialState: AuthState = {
  userToken: null,
  userData: null,
  isLoading: true,
  isSignout: false,
};

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'RESTORE_TOKEN':
      return {
        ...state,
        userToken: action.token,
        userData: action.userData,
        isLoading: false,
      };
    case 'SIGN_IN':
      return {
        ...state,
        userToken: action.token,
        userData: action.userData,
        isSignout: false,
        isLoading: false,
      };
    case 'SIGN_OUT':
      return {
        ...state,
        userToken: null,
        userData: null,
        isSignout: true,
        isLoading: false,
      };
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.isLoading,
      };
    default:
      return state;
  }
};

interface AuthContextType {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const bootstrapAsync = async () => {
      let userToken: string | null = null;
      let userData: User | null = null;

      try {
        userToken = await SecureStore.getItemAsync('userToken');
        const userDataStr = await SecureStore.getItemAsync('userData');
        if (userDataStr) {
          userData = JSON.parse(userDataStr);
        }
      } catch (e) {
        console.error('Failed to restore token:', e);
      }

      dispatch({ type: 'RESTORE_TOKEN', token: userToken, userData });
    };

    bootstrapAsync();
  }, []);

  const authContext: AuthContextType = {
    state,
    signIn: async (email: string, password: string) => {
      dispatch({ type: 'SET_LOADING', isLoading: true });
      try {
        const response = await api.post('/users/login', { email, password });
        const { token, user } = response.data;

        await SecureStore.setItemAsync('userToken', token);
        await SecureStore.setItemAsync('userData', JSON.stringify(user));

        dispatch({ type: 'SIGN_IN', token, userData: user });
      } catch (error: any) {
        dispatch({ type: 'SET_LOADING', isLoading: false });
        throw new Error(error.response?.data?.message || 'Login failed');
      }
    },
    signOut: async () => {
      await SecureStore.deleteItemAsync('userToken');
      await SecureStore.deleteItemAsync('userData');
      await SecureStore.deleteItemAsync('zabbixPassword');
      await clearZabbixAuth();
      dispatch({ type: 'SIGN_OUT' });
    },
  };


  useEffect(() => {
    const registerPushToken = async () => {
      if (!state.userToken || !state.userData?.id) {
        return;
      }
      if (Constants.appOwnership === "expo") {
        return;
      }

      console.log("Registering push token for user:", state.userData.id);

      const Notifications = await import("expo-notifications");
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== "granted") {
        return;
      }

      const projectId =
        Constants.easConfig?.projectId ||
        Constants.expoConfig?.extra?.eas?.projectId ||
        undefined;
      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      const expoToken = tokenResponse?.data;
      if (!expoToken) {
        return;
      }

      const cacheKey = "pushToken";
      const cached = await SecureStore.getItemAsync(cacheKey);
      if (cached === expoToken) {
        return;
      }

      await api.post(
        `users/push-token`,
        { token: expoToken, platform: Platform.OS },
        { headers: { Authorization: `Bearer ${state.userToken}` } },
      );

      await SecureStore.setItemAsync(cacheKey, expoToken);
    };

    registerPushToken();
  }, [state.userToken, state.userData?.id]);

  return (
    <AuthContext.Provider value={authContext}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};