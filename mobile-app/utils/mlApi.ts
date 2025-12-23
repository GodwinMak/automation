import api from './api';

/**
 * Analyze customer traffic for anomalies
 */
export const analyzeCustomerAnomalies = async (
  customerId: string,
  customerType: string,
  hours: number = 24
) => {
  try {
    const response = await api.get(`/ml/analyze/customer/${customerId}`, {
      params: { customerType, hours },
    });
    return response.data;
  } catch (error: any) {
    console.error('ML anomaly analysis error:', error);
    throw new Error(error.response?.data?.message || 'Failed to analyze traffic');
  }
};

/**
 * Forecast customer P95
 */
export const forecastCustomerP95 = async (
  customerId: string,
  customerType: string
) => {
  try {
    const response = await api.get(`/ml/forecast/customer/${customerId}`, {
      params: { customerType },
    });
    return response.data;
  } catch (error: any) {
    console.error('ML forecast error:', error);
    throw new Error(error.response?.data?.message || 'Failed to forecast P95');
  }
};

/**
 * Get dashboard ML insights
 */
export const getDashboardInsights = async () => {
  try {
    const response = await api.get('/ml/dashboard/insights');
    return response.data;
  } catch (error: any) {
    console.error('ML insights error:', error);
    // Return default data if ML service is unavailable
    return {
      status: 'unavailable',
      timestamp: new Date().toISOString(),
      anomaly_summary: {
        total_analyzed: 0,
        anomalies_detected: 0,
        critical_count: 0,
        warning_count: 0,
      },
      forecast_summary: {
        total_forecasted: 0,
        upgrades_recommended: 0,
        high_urgency: 0,
        medium_urgency: 0,
      },
      recent_anomalies: [],
      upgrade_recommendations: [],
    };
  }
};

/**
 * Analyze traffic data for anomalies
 */
export const analyzeTrafficAnomalies = async (trafficData: any[]) => {
  try {
    const response = await api.post('/ml/analyze/anomalies', {
      traffic_data: trafficData,
    });
    return response.data;
  } catch (error: any) {
    console.error('ML traffic analysis error:', error);
    throw new Error(error.response?.data?.message || 'Failed to analyze traffic');
  }
};

/**
 * Format bytes to human readable
 */
export const formatBytesML = (bytes: number): string => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} Gbps`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} Mbps`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} Kbps`;
  return `${bytes.toFixed(2)} bps`;
};

/**
 * Get health status color
 */
export const getHealthColor = (status: string): string => {
  switch (status) {
    case 'healthy':
      return '#22c55e'; // green
    case 'warning':
      return '#eab308'; // yellow
    case 'critical':
      return '#ef4444'; // red
    default:
      return '#6b7280'; // gray
  }
};

/**
 * Get urgency color
 */
export const getUrgencyColor = (urgency: string): string => {
  switch (urgency) {
    case 'high':
      return '#ef4444'; // red
    case 'medium':
      return '#f97316'; // orange
    case 'low':
      return '#eab308'; // yellow
    default:
      return '#22c55e'; // green
  }
};

