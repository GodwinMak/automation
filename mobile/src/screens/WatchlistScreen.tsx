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

interface WatchlistItem {
  id: string;
  customerId: string;
  customerName: string;
  customerType: 'DIA' | 'IPT' | 'Shared';
  interface: string;
  cid: string;
  nbr: string;
  currentStatus: string;
}

export const WatchlistScreen = () => {
  const navigation = useNavigation();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await api.get('/favorites');
      setWatchlist(res.data.favorites || []);
    } catch (error) {
      console.error('Error fetching watchlist:', error);
      Alert.alert('Error', 'Failed to load watchlist');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchWatchlist();
  }, [fetchWatchlist]);

  const handleRemoveFromWatchlist = async (favoriteId: string) => {
    Alert.alert(
      'Remove from Watchlist',
      'Are you sure you want to remove this customer from your watchlist?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/favorites/${favoriteId}`);
              setWatchlist((prev) => prev.filter((item) => item.id !== favoriteId));
            } catch (error) {
              Alert.alert('Error', 'Failed to remove from watchlist');
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'up':
        return '#22c55e';
      case 'down':
        return '#ef4444';
      default:
        return '#f59e0b';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'DIA':
        return '#6366f1';
      case 'IPT':
        return '#8b5cf6';
      case 'Shared':
        return '#ec4899';
      default:
        return '#6b7280';
    }
  };

  const renderItem = ({ item }: { item: WatchlistItem }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        navigation.navigate('CustomerDetail' as never, { customer: item } as never)
      }
      onLongPress={() => handleRemoveFromWatchlist(item.id)}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.statusIndicator,
            { backgroundColor: getStatusColor(item.currentStatus) },
          ]}
        />
        <Text style={styles.customerName} numberOfLines={1}>
          {item.customerName}
        </Text>
        <View
          style={[
            styles.typeBadge,
            { backgroundColor: getTypeColor(item.customerType) + '20' },
          ]}
        >
          <Text style={[styles.typeText, { color: getTypeColor(item.customerType) }]}>
            {item.customerType}
          </Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.infoRow}>
          <Text style={styles.label}>Interface</Text>
          <Text style={styles.value} numberOfLines={1}>
            {item.interface || 'N/A'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>CID</Text>
          <Text style={styles.value}>{item.cid || 'N/A'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>NBR</Text>
          <Text style={styles.value} numberOfLines={1}>
            {item.nbr || 'N/A'}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(item.currentStatus) + '20' },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: getStatusColor(item.currentStatus) },
            ]}
          >
            {item.currentStatus?.toUpperCase() || 'UNKNOWN'}
          </Text>
        </View>
        <Text style={styles.tapHint}>Long press to remove</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={watchlist}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No customers in watchlist</Text>
            <Text style={styles.emptySubtitle}>
              Add customers to your watchlist to monitor them here
            </Text>
          </View>
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
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  customerName: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardBody: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: '#64748b',
  },
  value: {
    fontSize: 14,
    color: '#e2e8f0',
    flex: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  tapHint: {
    fontSize: 10,
    color: '#475569',
    fontStyle: 'italic',
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
});

