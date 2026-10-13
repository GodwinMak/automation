import React, { useState, useEffect } from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReusableTable } from "@/components/Table";
import { Button } from "@/components/ui/button";
import {
  Star,
  Network,
  Globe,
  Share2,
  Trash2,
  Eye,
  MessageSquare,
  ArrowUpCircle,
  ArrowDownCircle,
  Waypoints,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";

interface Favorite {
  id: string;
  customerId: string;
  customerName: string;
  customerType: "DIA" | "IPT" | "Shared" | "L3VPN" | "FTTH" | "L2VPN";
  interface: string;
  cid: string;
  nbr: string;
  notes: string;
  status: string;
  switchName: string;
  smsAlertsEnabled: boolean;
  createdAt: string;
}

interface Summary {
  total: number;
  diaCount: number;
  iptCount: number;
  sharedCount: number;
  l2vpnCount: number;
  upCount: number;
  downCount: number;
}

const Watchlist = () => {
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  // Notes modal
  const [notesModal, setNotesModal] = useState(false);
  const [selectedFavorite, setSelectedFavorite] = useState<Favorite | null>(null);
  const [notes, setNotes] = useState("");

  // Fetch summary
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await axios.get(`${PRODUCTION_URL}/favorites/summary`);
        setSummary(res.data);
      } catch (error) {
        console.error("Error fetching summary:", error);
      }
    };
    fetchSummary();
  }, [favorites]);

  // Fetch favorites
  useEffect(() => {
    const fetchFavorites = async () => {
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/favorites?page=${page}&pageSize=${pageSize}&search=${search}&type=${typeFilter}`
        );
        setFavorites(res.data.favorites || []);
        setTotalPages(res.data.totalPages || 1);
      } catch (error) {
        console.error("Error fetching favorites:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchFavorites();
  }, [page, pageSize, search, typeFilter]);

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setPage(1);
  };

  const handleRemoveFavorite = async (id: string) => {
    try {
      await axios.delete(`${PRODUCTION_URL}/favorites/${id}`);
      setFavorites(favorites.filter((f) => f.id !== id));
      toast({
        title: "Removed from watchlist",
        description: "Customer has been removed from your watchlist.",
      });
    } catch (error) {
      console.error("Error removing favorite:", error);
      toast({
        title: "Error",
        description: "Failed to remove from watchlist.",
        variant: "destructive",
      });
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedFavorite) return;
    try {
      await axios.put(`${PRODUCTION_URL}/favorites/${selectedFavorite.id}/notes`, {
        notes,
      });
      setFavorites(
        favorites.map((f) =>
          f.id === selectedFavorite.id ? { ...f, notes } : f
        )
      );
      setNotesModal(false);
      toast({
        title: "Notes saved",
        description: "Your notes have been saved.",
      });
    } catch (error) {
      console.error("Error saving notes:", error);
      toast({
        title: "Error",
        description: "Failed to save notes.",
        variant: "destructive",
      });
    }
  };

  const handleToggleSmsAlerts = async (favorite: Favorite) => {
    const next = !favorite.smsAlertsEnabled;
    setFavorites((prev) =>
      prev.map((f) => (f.id === favorite.id ? { ...f, smsAlertsEnabled: next } : f))
    );
    try {
      await axios.put(`${PRODUCTION_URL}/favorites/${favorite.id}/sms-alerts`, {
        smsAlertsEnabled: next,
      });
    } catch (error) {
      console.error("Error updating SMS alerts:", error);
      setFavorites((prev) =>
        prev.map((f) => (f.id === favorite.id ? { ...f, smsAlertsEnabled: !next } : f))
      );
      toast({
        title: "Error",
        description: "Failed to update SMS alert preference.",
        variant: "destructive",
      });
    }
  };

  const openNotesModal = (favorite: Favorite) => {
    setSelectedFavorite(favorite);
    setNotes(favorite.notes || "");
    setNotesModal(true);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "DIA":
        return <Network className="h-4 w-4 text-blue-500" />;
      case "IPT":
        return <Globe className="h-4 w-4 text-purple-500" />;
      case "Shared":
        return <Share2 className="h-4 w-4 text-orange-500" />;
      case "L2VPN":
        return <Waypoints className="h-4 w-4 text-teal-500" />;
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
      case "L2VPN":
        return "bg-teal-500/10 text-teal-500 border-teal-500/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const navigateToCustomer = (favorite: Favorite) => {
    // L2VPN circuits have no standalone detail route to deep-link to like
    // the other types (their view page needs a full computed circuit object
    // with hops, not just the favorite's id/interface) — send the user to
    // the circuits list pre-filtered by customer name instead.
    if (favorite.customerType === "L2VPN") {
      navigate("/l2vpn-circuits", { state: { search: favorite.customerName } });
      return;
    }

    const routes: Record<string, string> = {
      DIA: "/viewcustomer",
      IPT: "/view-ipt-customer",
      Shared: "/view-shared-customer",
    };
    navigate(routes[favorite.customerType], {
      state: { customer: { id: favorite.customerId, ...favorite } },
    });
  };

  const columns = [
    {
      key: "customerName",
      label: "Customer",
      render: (row: Favorite) => (
        <div className="flex items-center gap-2">
          {getTypeIcon(row.customerType)}
          <div>
            <div className="font-medium">{row.customerName}</div>
            <div className="text-xs text-muted-foreground">{row.cid || row.interface}</div>
          </div>
        </div>
      ),
    },
    {
      key: "customerType",
      label: "Type",
      render: (row: Favorite) => (
        <span className={`px-2 py-1 text-xs rounded border ${getTypeBadgeClass(row.customerType)}`}>
          {row.customerType}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row: Favorite) => (
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            row.status === "up"
              ? "bg-success/10 text-success"
              : row.status === "down"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {row.status === "up" ? (
            <ArrowUpCircle className="h-3 w-3" />
          ) : row.status === "down" ? (
            <ArrowDownCircle className="h-3 w-3" />
          ) : null}
          {row.status?.toUpperCase() || "UNKNOWN"}
        </span>
      ),
    },
    { key: "nbr", label: "NBR" },
    { key: "switchName", label: "Switch" },
    {
      key: "smsAlertsEnabled",
      label: "SMS Alerts",
      render: (row: Favorite) => (
        <Switch
          checked={row.smsAlertsEnabled}
          onCheckedChange={() => handleToggleSmsAlerts(row)}
        />
      ),
    },
    {
      key: "notes",
      label: "Notes",
      render: (row: Favorite) => (
        <div className="max-w-[150px] truncate text-muted-foreground text-sm">
          {row.notes || "-"}
        </div>
      ),
    },
  ];

  const Action = (favorite: Favorite) => (
    <>
      <DropdownMenuItem onClick={() => navigateToCustomer(favorite)}>
        <Eye className="h-4 w-4 mr-2" />
        View Customer
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openNotesModal(favorite)}>
        <MessageSquare className="h-4 w-4 mr-2" />
        Edit Notes
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => handleRemoveFavorite(favorite.id)}
        className="text-destructive"
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Remove from Watchlist
      </DropdownMenuItem>
    </>
  );

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Star className="h-8 w-8 text-yellow-500 fill-yellow-500" />
          My Watchlist
        </h1>
        <p className="text-muted-foreground">
          Monitor your favorite customers and track their status in real-time.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
        <Card className="border-yellow-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Watched
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">
              {summary?.total || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Network className="h-3 w-3 text-blue-500" />
              DIA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">
              {summary?.diaCount || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Globe className="h-3 w-3 text-purple-500" />
              IPT
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-500">
              {summary?.iptCount || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="border-orange-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Share2 className="h-3 w-3 text-orange-500" />
              Shared
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">
              {summary?.sharedCount || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="border-teal-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Waypoints className="h-3 w-3 text-teal-500" />
              L2VPN
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-teal-500">
              {summary?.l2vpnCount || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="border-success/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <ArrowUpCircle className="h-3 w-3 text-success" />
              UP
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {summary?.upCount || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <ArrowDownCircle className="h-3 w-3 text-destructive" />
              DOWN
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {summary?.downCount || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Watchlist Table */}
      <ReusableTable
        title="Watched Customers"
        description="Your favorite customers with live status monitoring"
        columns={columns}
        data={favorites}
        actions={Action}
        loading={loading}
        filters={
          <>
            <label className="mr-2 font-medium">Type:</label>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                setTypeFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Filter Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="DIA">DIA</SelectItem>
                <SelectItem value="IPT">IPT</SelectItem>
                <SelectItem value="Shared">Shared</SelectItem>
                <SelectItem value="L2VPN">L2VPN</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        headerActions={
          <input
            type="text"
            placeholder="Search customer..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="border border-border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary bg-background text-foreground"
          />
        }
        pagination={{
          page,
          totalPages,
          onPageChange: (newPage) => setPage(newPage),
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
      />

      {/* Notes Modal */}
      <Dialog open={notesModal} onOpenChange={setNotesModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Notes - {selectedFavorite?.customerName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Add notes about this customer..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNotes}>Save Notes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Watchlist;
