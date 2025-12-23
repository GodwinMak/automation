import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

interface DashboardStats {
  diaTotal: number;
  diaUp: number;
  diaDown: number;
  iptTotal: number;
  iptUp: number;
  iptDown: number;
  sharedTotal: number;
  sharedUp: number;
  sharedDown: number;
  watchlistCount: number;
}

interface Notification {
  id: string;
  customerName: string;
  customerType: string;
  currentStatus: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export const HomeScreen = () => {
  const { state, signOut } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Fetch notifications
      const notifRes = await api.get('/notifications?pageSize=5');
      setNotifications(notifRes.data.notifications);
      
      // Fetch unread count
      const countRes = await api.get('/notifications/unread-count');
      setUnreadCount(countRes.data.unreadCount);
      
      // Fetch watchlist count
      const watchlistRes = await api.get('/favorites');
      
      // Calculate stats from watchlist or fetch from dashboard endpoint
      setStats({
        diaTotal: 0,
        diaUp: 0,
        diaDown: 0,
        iptTotal: 0,
        iptUp: 0,
        iptDown: 0,
        sharedTotal: 0,
        sharedUp: 0,
        sharedDown: 0,
        watchlistCount: watchlistRes.data.favorites?.length || 0,
      });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getRoleBadge = () => {
    switch (state.userData?.role) {
      case 'admin':
        return { label: 'Admin', color: '#ef4444' };
      case 'operator':
        return { label: 'Operator', color: '#3b82f6' };
      case 'customer_relation':
        return { label: 'Customer Relation', color: '#22c55e' };
      default:
        return { label: 'User', color: '#6b7280' };
    }
  };

  const roleBadge = getRoleBadge();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#6366f1"
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name}>
            {state.userData?.fullName || state.userData?.username}
          </Text>
          <View style={[styles.roleBadge, { backgroundColor: roleBadge.color + '20' }]}>
            <Text style={[styles.roleText, { color: roleBadge.color }]}>
              {roleBadge.label}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={signOut}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats?.watchlistCount || 0}</Text>
          <Text style={styles.statLabel}>Watchlist</Text>
        </View>
        <View style={[styles.statCard, styles.alertCard]}>
          <Text style={[styles.statNumber, { color: '#ef4444' }]}>
            {unreadCount}
          </Text>
          <Text style={styles.statLabel}>Alerts</Text>
        </View>
      </View>

      {/* Recent Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Alerts</Text>
        {notifications.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No recent alerts</Text>
          </View>
        ) : (
          notifications.map((notif) => (
            <TouchableOpacity
              key={notif.id}
              style={[
                styles.notificationCard,
                !notif.isRead && styles.unreadCard,
              ]}
            >
              <View style={styles.notificationHeader}>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        notif.currentStatus === 'down' ? '#ef4444' : '#22c55e',
                    },
                  ]}
                />
                <Text style={styles.notificationTitle} numberOfLines={1}>
                  {notif.customerName}
                </Text>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeText}>{notif.customerType}</Text>
                </View>
              </View>
              <Text style={styles.notificationMessage} numberOfLines={2}>
                {notif.message}
              </Text>
              <Text style={styles.notificationTime}>
                {formatTime(notif.createdAt)}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  greeting: {
    fontSize: 14,
    color: '#94a3b8',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  logoutText: {
    color: '#ef4444',
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  alertCard: {
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#6366f1',
  },
  statLabel: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  emptyState: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748b',
  },
  notificationCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  unreadCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  notificationTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  typeBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  notificationMessage: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 8,
  },
  notificationTime: {
    fontSize: 12,
    color: '#64748b',
  },
});

