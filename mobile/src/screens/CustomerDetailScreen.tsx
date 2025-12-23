import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import api from '../utils/api';

interface CustomerData {
  id: string;
  interface: string;
  customerName: string;
  cid: string;
  nbr: string;
  switchName: string;
  mbps: string;
  operationalStatus: string;
  client_db?: {
    email_address?: string;
    phone_number?: string;
    customer_name_pastel?: string;
    area?: string;
    provider?: string;
    special_comments?: string;
  };
}

export const CustomerDetailScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { customer } = route.params as { customer: any };
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isInWatchlist, setIsInWatchlist] = useState(false);

  useEffect(() => {
    fetchCustomerDetails();
    checkWatchlistStatus();
  }, []);

  const fetchCustomerDetails = async () => {
    try {
      let endpoint = '';
      switch (customer.customerType) {
        case 'DIA':
          endpoint = `/customers/${customer.customerId}`;
          break;
        case 'IPT':
          endpoint = `/iptcustomers/${customer.customerId}`;
          break;
        case 'Shared':
          endpoint = `/sharedcustomers/${customer.customerId}`;
          break;
        default:
          throw new Error('Unknown customer type');
      }

      const res = await api.get(endpoint);
      setCustomerData(res.data.customer || res.data);
    } catch (error) {
      console.error('Error fetching customer details:', error);
      // Use the customer data from the route params as fallback
      setCustomerData({
        id: customer.customerId,
        interface: customer.interface,
        customerName: customer.customerName,
        cid: customer.cid,
        nbr: customer.nbr,
        switchName: '',
        mbps: '',
        operationalStatus: customer.currentStatus || 'unknown',
      });
    } finally {
      setLoading(false);
    }
  };

  const checkWatchlistStatus = async () => {
    try {
      const res = await api.get('/favorites');
      const favorites = res.data.favorites || [];
      const found = favorites.some(
        (f: any) =>
          f.customerId === customer.customerId &&
          f.customerType === customer.customerType
      );
      setIsInWatchlist(found);
    } catch (error) {
      console.error('Error checking watchlist:', error);
    }
  };

  const toggleWatchlist = async () => {
    try {
      if (isInWatchlist) {
        // Remove from watchlist
        const res = await api.get('/favorites');
        const favorites = res.data.favorites || [];
        const favorite = favorites.find(
          (f: any) =>
            f.customerId === customer.customerId &&
            f.customerType === customer.customerType
        );
        if (favorite) {
          await api.delete(`/favorites/${favorite.id}`);
          setIsInWatchlist(false);
          Alert.alert('Success', 'Removed from watchlist');
        }
      } else {
        // Add to watchlist
        await api.post('/favorites', {
          customerId: customer.customerId,
          customerType: customer.customerType,
          customerName: customerData?.customerName || customer.customerName,
          interface: customerData?.interface || customer.interface,
          cid: customerData?.cid || customer.cid,
          nbr: customerData?.nbr || customer.nbr,
          currentStatus: customerData?.operationalStatus || 'unknown',
        });
        setIsInWatchlist(true);
        Alert.alert('Success', 'Added to watchlist');
      }
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.message || 'Failed to update watchlist'
      );
    }
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

  const handleCall = (phoneNumber: string) => {
    Linking.openURL(`tel:${phoneNumber}`);
  };

  const handleEmail = (email: string) => {
    Linking.openURL(`mailto:${email}`);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  const data = customerData || customer;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Status Header */}
      <View style={styles.statusHeader}>
        <View
          style={[
            styles.statusIndicator,
            { backgroundColor: getStatusColor(data.operationalStatus) },
          ]}
        />
        <Text
          style={[
            styles.statusText,
            { color: getStatusColor(data.operationalStatus) },
          ]}
        >
          {data.operationalStatus?.toUpperCase() || 'UNKNOWN'}
        </Text>
        <View style={styles.typeBadge}>
          <Text style={styles.typeText}>{customer.customerType}</Text>
        </View>
      </View>

      {/* Customer Name */}
      <Text style={styles.customerName}>{data.customerName}</Text>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            isInWatchlist && styles.actionButtonActive,
          ]}
          onPress={toggleWatchlist}
        >
          <Text
            style={[
              styles.actionButtonText,
              isInWatchlist && styles.actionButtonTextActive,
            ]}
          >
            {isInWatchlist ? '★ In Watchlist' : '☆ Add to Watchlist'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Customer Info Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Customer Information</Text>
        
        <View style={styles.infoRow}>
          <Text style={styles.label}>Interface</Text>
          <Text style={styles.value}>{data.interface || 'N/A'}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.label}>CID</Text>
          <Text style={styles.value}>{data.cid || 'N/A'}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.label}>NBR</Text>
          <Text style={styles.value}>{data.nbr || 'N/A'}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.label}>Switch</Text>
          <Text style={styles.value}>{data.switchName || 'N/A'}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.label}>Bandwidth</Text>
          <Text style={styles.value}>
            {data.mbps ? `${data.mbps} Mbps` : 'N/A'}
          </Text>
        </View>
      </View>

      {/* Contact Info Card */}
      {data.client_db && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact Information</Text>
          
          {data.client_db.email_address && (
            <TouchableOpacity
              style={styles.contactRow}
              onPress={() => handleEmail(data.client_db!.email_address!)}
            >
              <Text style={styles.label}>Email</Text>
              <Text style={[styles.value, styles.linkText]}>
                {data.client_db.email_address}
              </Text>
            </TouchableOpacity>
          )}
          
          {data.client_db.phone_number && (
            <TouchableOpacity
              style={styles.contactRow}
              onPress={() => handleCall(data.client_db!.phone_number!)}
            >
              <Text style={styles.label}>Phone</Text>
              <Text style={[styles.value, styles.linkText]}>
                {data.client_db.phone_number}
              </Text>
            </TouchableOpacity>
          )}
          
          {data.client_db.area && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Area</Text>
              <Text style={styles.value}>{data.client_db.area}</Text>
            </View>
          )}
          
          {data.client_db.provider && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Provider</Text>
              <Text style={styles.value}>{data.client_db.provider}</Text>
            </View>
          )}
          
          {data.client_db.special_comments && (
            <View style={styles.commentsSection}>
              <Text style={styles.label}>Special Comments</Text>
              <Text style={styles.comments}>
                {data.client_db.special_comments}
              </Text>
            </View>
          )}
        </View>
      )}
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
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  typeBadge: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  customerName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  quickActions: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionButtonActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  actionButtonText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 14,
  },
  actionButtonTextActive: {
    color: '#fff',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  label: {
    fontSize: 14,
    color: '#64748b',
  },
  value: {
    fontSize: 14,
    color: '#e2e8f0',
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  linkText: {
    color: '#6366f1',
  },
  commentsSection: {
    paddingTop: 12,
  },
  comments: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 8,
    lineHeight: 20,
  },
});

