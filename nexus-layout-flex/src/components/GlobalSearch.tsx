import React, { useState, useEffect, useRef } from "react";
import { Search, X, Network, Globe, Share2, Route, Wifi, Waypoints, ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";

interface SearchResult {
  id: string;
  customerName: string;
  cid: string;
  interface: string;
  nbr: string;
  vlan?: string;
  status: string;
  switchName: string;
  type: "DIA" | "IPT" | "Shared" | "L3VPN" | "FTTH" | "L2VPN";
  route: string;
  data: any;
}

export const GlobalSearch = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.length >= 2) {
        performSearch();
      } else {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+K or Cmd+K to focus search
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }

      // Escape to close
      if (event.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Arrow key navigation
  const handleKeyNavigation = (event: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (event.key === "Enter" && selectedIndex >= 0) {
      event.preventDefault();
      handleResultClick(results[selectedIndex]);
    }
  };

  const performSearch = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/search?q=${encodeURIComponent(query)}&limit=10`);
      console.log(res)
      setResults(res.data.results || []);
      setIsOpen(true);
      setSelectedIndex(-1);
    } catch (error) {
      console.error("Search error:", error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleResultClick = (result: SearchResult) => {
    setIsOpen(false);
    setQuery("");
    
    // Navigate based on type
    if (result.type === "DIA") {
      navigate(result.route, { state: { customer: result.data } });
    } else if (result.type === "IPT") {
      navigate(result.route, { state: { customer: result.data } });
    } else if (result.type === "Shared") {
      navigate(result.route, { state: { customer: result.data } });
    } else if (result.type === "L3VPN") {
      navigate(result.route, { state: { customer: result.data } });
    } else if (result.type === "FTTH") {
      navigate(result.route, { state: { customer: result.data } });
    } else if (result.type === "L2VPN") {
      // ViewL2VPNCircuit.tsx expects the full computed circuit (with hops)
      // under location.state.circuit, not "customer" like the other types.
      navigate(result.route, { state: { circuit: result.data } });
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "DIA":
        return <Network className="h-4 w-4 text-blue-500" />;
      case "IPT":
        return <Globe className="h-4 w-4 text-purple-500" />;
      case "Shared":
        return <Share2 className="h-4 w-4 text-orange-500" />;
      case "L3VPN":
        return <Route className="h-4 w-4 text-green-500" />;
      case "FTTH":
        return <Wifi className="h-4 w-4 text-teal-500" />;
      case "L2VPN":
        return <Waypoints className="h-4 w-4 text-cyan-500" />;
      default:
        return <Network className="h-4 w-4" />;
    }
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case "DIA":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "IPT":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "Shared":
        return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      case "L3VPN":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "FTTH":
        return "bg-teal-500/10 text-teal-500 border-teal-500/20";
      case "L2VPN":
        return "bg-cyan-500/10 text-cyan-500 border-cyan-500/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setIsOpen(false);
  };

  return (
    <div ref={searchRef} className="relative w-full max-w-md">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search customers... (Ctrl+K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          onKeyDown={handleKeyNavigation}
          className="pl-10 pr-10 bg-background border-border focus:ring-2 focus:ring-primary"
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && (query.length >= 2) && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {loading ? (
            <div className="p-4 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              <p className="text-sm">Searching...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <p className="text-sm">No results found for "{query}"</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              {/* Group header */}
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/50 border-b border-border">
                Found {results.length} customer{results.length > 1 ? "s" : ""}
              </div>

              {/* Results list */}
              {results.map((result, index) => (
                <div
                  key={`${result.type}-${result.id}`}
                  onClick={() => handleResultClick(result)}
                  className={`px-3 py-3 cursor-pointer border-b border-border last:border-b-0 transition-colors ${
                    selectedIndex === index
                      ? "bg-accent"
                      : "hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Type Icon */}
                    <div className="mt-0.5">{getTypeIcon(result.type)}</div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-foreground truncate">
                          {result.customerName}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 text-xs font-medium rounded border ${getTypeBadgeClass(
                            result.type
                          )}`}
                        >
                          {result.type}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                            result.status === "up"
                              ? "bg-success/10 text-success"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {result.status?.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {result.cid && <span>CID: {result.cid}</span>}
                        {result.interface && <span>• {result.interface}</span>}
                        {result.nbr && <span>• {result.nbr}</span>}
                        {result.type === "L2VPN" && result.vlan && <span>• VLAN {result.vlan}</span>}
                      </div>
                    </div>

                    {/* Arrow */}
                    <ArrowRight className="h-4 w-4 text-muted-foreground mt-1" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer hint */}
          <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30 border-t border-border flex items-center justify-between">
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">↑</kbd>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs ml-1">↓</kbd>
              <span className="ml-1">to navigate</span>
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Enter</kbd>
              <span className="ml-1">to select</span>
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Esc</kbd>
              <span className="ml-1">to close</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;

