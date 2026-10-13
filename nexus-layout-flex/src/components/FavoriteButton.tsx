import React, { useState, useEffect } from "react";
import axios from "axios";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRODUCTION_URL } from "@/utils/Api";
import { toast } from "@/hooks/use-toast";

interface FavoriteButtonProps {
  customerId: string;
  customerName: string;
  customerType: "DIA" | "IPT" | "Shared" | "L3VPN" | "FTTH" | "L2VPN";
  interface?: string;
  cid?: string;
  nbr?: string;
}

export const FavoriteButton = ({
  customerId,
  customerName,
  customerType,
  interface: iface,
  cid,
  nbr,
}: FavoriteButtonProps) => {
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkIfFavorite();
  }, [customerId, customerType]);

  const checkIfFavorite = async () => {
    try {
      const res = await axios.get(
        `${PRODUCTION_URL}/favorites/check?customerId=${customerId}&customerType=${customerType}`
      );
      setIsFavorite(res.data.isFavorite);
    } catch (error) {
      console.error("Error checking favorite:", error);
    }
  };

  const toggleFavorite = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${PRODUCTION_URL}/favorites/toggle`, {
        customerId,
        customerName,
        customerType,
        interface: iface,
        cid,
        nbr,
      });

      setIsFavorite(res.data.isFavorite);

      toast({
        title: res.data.isFavorite ? "Added to Watchlist" : "Removed from Watchlist",
        description: res.data.isFavorite
          ? `${customerName} is now in your watchlist.`
          : `${customerName} has been removed from your watchlist.`,
      });
    } catch (error) {
      console.error("Error toggling favorite:", error);
      toast({
        title: "Error",
        description: "Failed to update watchlist.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={isFavorite ? "default" : "outline"}
      size="sm"
      onClick={toggleFavorite}
      disabled={loading}
      className={`gap-2 ${
        isFavorite
          ? "bg-yellow-500 hover:bg-yellow-600 text-black"
          : "hover:bg-yellow-500/10 hover:text-yellow-500 hover:border-yellow-500"
      }`}
    >
      <Star
        className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`}
      />
      {isFavorite ? "In Watchlist" : "Add to Watchlist"}
    </Button>
  );
};

export default FavoriteButton;

