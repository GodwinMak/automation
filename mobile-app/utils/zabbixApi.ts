import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const ZABBIX_API_URL = 'https://monitoring.liquidtelecom.net/api_jsonrpc.php';

// Zabbix credentials from environment variables
const ZABBIX_USERNAME = process.env.EXPO_PUBLIC_ZABBIX_USERNAME || '';
const ZABBIX_PASSWORD = process.env.EXPO_PUBLIC_ZABBIX_PASSWORD || '';

interface ZabbixPayload {
  method: string;
  params: Record<string, any>;
  id?: number;
  auth?: string | null;
}

/**
 * Make a Zabbix API call
 */
export const zabbixApi = async (payload: ZabbixPayload) => {
  const auth = await SecureStore.getItemAsync('zabbixAuth');
  
  const res = await axios.post(
    ZABBIX_API_URL,
    {
      jsonrpc: '2.0',
      ...payload,
      auth: payload.auth ?? auth,
    },
    {
      headers: { 
        'Content-Type': 'application/json',
        Authorization: undefined,
      },
    }
  );
  
  if (res.data.error) {
    throw new Error(res.data.error.message || 'Zabbix API error');
  }
  
  return res.data.result;
};

/**
 * Login to Zabbix and store auth token
 */
export const loginToZabbix = async (): Promise<string | null> => {
  try {
    // Clear any existing auth
    await SecureStore.deleteItemAsync('zabbixAuth');
    
    const response = await axios.post(
      ZABBIX_API_URL,
      {
        jsonrpc: '2.0',
        method: 'user.login',
        params: {
          username: ZABBIX_USERNAME,
          password: ZABBIX_PASSWORD,
        },
        id: 1,
      },
      {
        headers: { 
          'Content-Type': 'application/json',
          Authorization: undefined,
        },
      }
    );
    // console.log(response.data);
    
    if (response.data.result) {
      await SecureStore.setItemAsync('zabbixAuth', response.data.result);
      console.log('Zabbix login successful');
    //   console.log("zabbixAuth", await SecureStore.getItemAsync('zabbixAuth'));
      return response.data.result;
    }


    
    return null;
  } catch (error) {
    console.error('Zabbix login failed:', error);
    return null;
  }
};

/**
 * Get the stored Zabbix auth token
 */
export const getZabbixAuth = async (): Promise<string | null> => {
  return await SecureStore.getItemAsync('zabbixAuth');
};

/**
 * Clear Zabbix auth token (on logout)
 */
export const clearZabbixAuth = async (): Promise<void> => {
  await SecureStore.deleteItemAsync('zabbixAuth');
};

/**
 * Map switch names to Zabbix host names
 */
export const getZabbixHostName = (switchName: string): string => {
  const hostMapping: Record<string, string> = {
    'LTZ-PE1-RAH': 'lo-0.ltz-pe1-rah.liquidtelecom.net',
    'LTZ-P1-DAR': 'lo-0.ltz-p1-dar.liquidtelecom.net',
    // 'LTZ-BNG1-RAH': 'lo-0.ltz-bng1-rah.liquidtelecom.net',
    // 'LTZ-BNG2-RAH': 'lo-0.ltz-bng2-rah.liquidtelecom.net',
    // Add more mappings as needed
  };
  return hostMapping[switchName] || switchName;
};

/**
 * Fetch graph data for a customer interface
 */
export const fetchCustomerGraph = async (switchName: string, interfaceName: string) => {
  const auth = await getZabbixAuth();
  if (!auth) {
    throw new Error('Zabbix not authenticated');
  }

  const zabbixHostName = getZabbixHostName(switchName);

  // 1. Get host ID
  const hosts = await zabbixApi({
    method: 'host.get',
    params: {
      output: ['hostid'],
      filter: {
        host: [zabbixHostName],
      },
    },
    id: 1,
    auth,
  });

  if (!hosts || hosts.length === 0) {
    throw new Error('Host not found in Zabbix');
  }

  const hostid = hosts[0].hostid;

  // 2. Get graph with items for the interface
  const graphs = await zabbixApi({
    method: 'graph.get',
    params: {
      hostids: [hostid],
      search: { name: interfaceName },
      output: 'extend',
      selectItems: 'extend',
    },
    id: 2,
    auth,
  });

  if (!graphs || graphs.length === 0) {
    throw new Error('Graph not found for this interface');
  }

  const items = graphs[0].items.map((i: any) => ({
    itemid: i.itemid,
    name: i.name,
  }));

  return { items, graph: graphs[0] };
};

/**
 * Fetch history data for graph items
 */
export const fetchGraphHistory = async (itemids: string[], range: string = '6h') => {
  const auth = await getZabbixAuth();
  if (!auth) {
    throw new Error('Zabbix not authenticated');
  }

  const now = Math.floor(Date.now() / 1000);
  let hours = 6;
  
  switch (range) {
    case '1h': hours = 1; break;
    case '6h': hours = 6; break;
    case '12h': hours = 12; break;
    case '24h': hours = 24; break;
    case '168h': hours = 168; break;
    case '720h': hours = 720; break;
  }

  const time_from = now - hours * 3600;

  const history = await zabbixApi({
    method: 'history.get',
    params: {
      history: 3,
      itemids,
      time_from,
      time_till: now,
      output: 'extend',
      sortfield: 'clock',
    },
    id: 3,
    auth,
  });

  return history;
};

/**
 * Calculate statistics from history values
 */
export const calcStats = (values: number[]) => {
  if (!values.length) return { max: 0, min: 0, avg: 0, p95: 0 };

  const nums = values.map(Number);
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;

  // Calculate 95th percentile using Zabbix method
  const position = n * 0.95;
  let p95;

  if (position % 1 !== 0) {
    const index = Math.ceil(position) - 1;
    p95 = sorted[Math.min(index, n - 1)];
  } else {
    const index1 = position - 1;
    const index2 = position;
    p95 = index2 >= n ? sorted[index1] : (sorted[index1] + sorted[index2]) / 2;
  }

  return {
    max: Math.max(...nums),
    min: Math.min(...nums),
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    p95: p95,
  };
};

/**
 * Format bytes to human readable format
 */
export const formatBytes = (bytes: number, unit: string = 'bps'): string => {
  if (bytes === 0) return '0 bps';
  
  const k = 1000;
  const sizes = unit === 'bps' 
    ? ['bps', 'Kbps', 'Mbps', 'Gbps'] 
    : ['B', 'KB', 'MB', 'GB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

