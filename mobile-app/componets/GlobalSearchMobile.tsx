import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import api from "@/utils/api";
import { router } from "expo-router";

interface SearchResult {
  id: string;
  customerName: string;
  interface: string;
  type: string;
  status?: string;
  cid?: string;
  nbr?: string;
}

export default function GlobalSearchMobile() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (text: string) => {
    setQuery(text);
    if (text.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const customerRes = await api.get(`/search?q=${encodeURIComponent(text)}&limit=10`);
      const customerResults = customerRes.data.results || [];
      setResults(customerResults);
    } catch (e) {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleResultPress = (item: SearchResult) => {
    router.push({
      pathname: "/customer/[id]",
      params: {
        id: item.id,
        customerType: item.type,
        customerName: item.customerName,
        interface: item.interface,
        cid: item.cid,
        nbr: item.nbr,
      },
    });
  };

  return (
    <View>
      {/* Search Input */}
      <View className="bg-slate-800 rounded-xl px-3 py-2 flex-row items-center mb-4">
        <Ionicons name="search" size={22} color="#6b7280" />
        <TextInput
          className="flex-1 ml-2 text-white"
          placeholder="Search users or customers..."
          placeholderTextColor="#6b7280"
          value={query}
          onChangeText={handleSearch}
          autoCapitalize="none"
        />
        {loading && <ActivityIndicator color="#fff" size="small" />}
      </View>

      {/* Results */}
      {query.length >= 2 && (
        <View>
          {results.length === 0 && !loading ? (
            <Text className="text-slate-500 text-center mt-8">No results found.</Text>
          ) : (
            results.map((item) => (
              <TouchableOpacity
                key={item.id}
                className="bg-slate-800 rounded-xl p-4 mb-2"
                onPress={() => handleResultPress(item)}
              >
                <Text className="text-white font-bold text-lg">{item.customerName}</Text>
                <Text className="text-slate-400">{item.interface}</Text>
                <Text className="text-xs text-slate-500 mt-1">
                  Type: {item.type}
                  {item.status ? ` | Status: ${item.status}` : ""}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </View>
  );
}