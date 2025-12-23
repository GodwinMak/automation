import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import api from '../utils/api';

interface Notification {
  id: string;
  customerId: string;
  customerName: string;
  customerType: 'DIA' | 'IPT' | 'Shared';
  interface: string;
  cid: string;
  nbr: string;
  previousStatus: string;
  currentStatus: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export const NotificationsScreen = () => {
  const navigation = useNavigation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchNotifications = useCallback(async (pageNum: number = 1) => {
    try {
      const res = await api.get(`/notifications?page=${pageNum}&pageSize=20`);
      const { notifications: newNotifications, totalPages } = res.data;
      
      if (pageNum === 1) {
        setNotifications(newNotifications);
      } else {
        setNotifications((prev) => [...prev, ...newNotifications]);
      }
      
      setHasMore(pageNum < totalPages);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setPage(1);
    fetchNotifications(1);
  }, [fetchNotifications]);

  const loadMore = () => {
    if (hasMore && !loading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchNotifications(nextPage);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await api.put(`/notifications/${notificationId}/read`);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: true } : n
        )
      );
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.put('/notifications/mark-all-read');
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (error) {
      Alert.alert('Error', 'Failed to mark all as read');
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      await api.delete(`/notifications/${notificationId}`);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    } catch (error) {
      Alert.alert('Error', 'Failed to delete notification');
    }
  };

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

  const handleNotificationPress = async (notification: Notification) => {
    if (!notification.isRead) {
      await markAsRead(notification.id);
    }
    
    navigation.navigate('CustomerDetail' as never, {
      customer: {
        customerId: notification.customerId,
        customerName: notification.customerName,
        customerType: notification.customerType,
        interface: notification.interface,
        cid: notification.cid,
        nbr: notification.nbr,
      },
    } as never);
  };

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.card, !item.isRead && styles.unreadCard]}
      onPress={() => handleNotificationPress(item)}
      onLongPress={() => {
        Alert.alert(
          'Delete Notification',
          'Are you sure you want to delete this notification?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => deleteNotification(item.id),
            },
          ]
        );
      }}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor:
                item.currentStatus === 'down' ? '#ef4444' : '#22c55e',
            },
          ]}
        />
        <Text style={styles.customerName} numberOfLines={1}>
          {item.customerName}
        </Text>
        <View style={styles.typeBadge}>
          <Text style={styles.typeText}>{item.customerType}</Text>
        </View>
      </View>

      <Text style={styles.message} numberOfLines={2}>
        {item.message}
      </Text>

      <View style={styles.cardFooter}>
        <Text style={styles.interface} numberOfLines={1}>
          {item.interface}
        </Text>
        <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
      </View>

      {!item.isRead && <View style={styles.unreadIndicator} />}
    </TouchableOpacity>
  );

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (loading && page === 1) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header Actions */}
      {unreadCount > 0 && (
        <View style={styles.headerActions}>
          <Text style={styles.unreadText}>
            {unreadCount} unread notification{unreadCount > 1 ? 's' : ''}
          </Text>
          <TouchableOpacity onPress={markAllAsRead}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySubtitle}>
              You'll see alerts here when your watched customers have status changes
            </Text>
          </View>
        }
        ListFooterComponent={
          hasMore && !loading ? (
            <ActivityIndicator style={styles.footerLoader} color="#6366f1" />
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  unreadText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  markAllText: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  unreadCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  customerName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  typeBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  message: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 12,
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  interface: {
    flex: 1,
    fontSize: 12,
    color: '#64748b',
  },
  time: {
    fontSize: 12,
    color: '#64748b',
  },
  unreadIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6366f1',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  footerLoader: {
    paddingVertical: 20,
  },
});

