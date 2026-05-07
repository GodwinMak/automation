import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';

// Update this to your production server IP
export const API_URL = 'https://automation.liquidmatics.co.tz';

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('userToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle token expiration
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('userToken');
      await SecureStore.deleteItemAsync('userData');
      router.replace('/');
    }
    return Promise.reject(error);
  }
);


// Register Expo push token
export async function registerPushToken(token: string, platform?: string) {
  try {
    await api.post('/push-token', { token, platform });
    return true;
  } catch (err) {
    return false;
  }
}

export default api;

