import React, { useState, useMemo, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Settings as SettingsIcon,
  Shield,
  Loader2,
  BellRing,
  Info,
  X,
} from "lucide-react";
import axios from "axios";
import { useAuthContext } from "@/hooks/useAuthContext";
import { PRODUCTION_URL } from "@/utils/Api";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

type AdjacencySide = {
  id: string;
  deviceName: string;
  neighborName: string;
  interface: string;
  pointToPointIp: string;
  state: "Up" | "Down";
};

// One physical link, grouped server-side from both devices' own-perspective
// rows (see Controller/isisAdjacent.js's getAdjacencyList) — pointToPointIp
// here is the /31 network key shared by both sides, not either side's host
// IP, so watching this entry matches alerts fired from either side's row.
type AdjacencyLink = {
  pointToPointIp: string;
  label: string;
  state: "Up" | "Down";
  sides: AdjacencySide[];
};

type IsisWatchEntry = {
  id: string;
  pointToPointIp: string;
  neighborName: string | null;
  interfaceName: string | null;
  deviceName: string | null;
};

type FavoriteRow = {
  id: string;
  customerName: string;
  customerType: string;
  smsAlertsEnabled: boolean;
};

export default function Settings() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("userData"));
  const { dispatch, logout } = useAuthContext();
  const { toast } = useToast();

  const [userDetails, setUserDetails] = useState({
    full_name: user.username || "",
    email: user.email || "",
    password: "",
  });

  const [secrety, setSecrety] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [loadingUser, setLoadingUser] = useState(false);
  const [loadingPass, setLoadingPass] = useState(false);
  // 1. Add state for password mismatch error
  const [passwordMismatchError, setPasswordMismatchError] = useState(false);

  // --- Notification preferences ---
  const [notifPrefs, setNotifPrefs] = useState({
    phoneNumber: "",
    canReceiveIsisSms: true,
    highTrafficSmsEnabled: true,
    isisWatchScope: "all" as "all" | "watchlist",
  });
  const [initialNotifPrefs, setInitialNotifPrefs] = useState(notifPrefs);
  const [loadingNotifPrefs, setLoadingNotifPrefs] = useState(false);
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  const isNotifPrefsChanged = useMemo(
    () => JSON.stringify(notifPrefs) !== JSON.stringify(initialNotifPrefs),
    [notifPrefs, initialNotifPrefs]
  );

  // ISIS node watch list
  const [adjacencyLinks, setAdjacencyLinks] = useState<AdjacencyLink[]>([]);
  const [isisWatchlist, setIsisWatchlist] = useState<IsisWatchEntry[]>([]);
  const [isisSearch, setIsisSearch] = useState("");
  const [loadingIsisPicker, setLoadingIsisPicker] = useState(false);

  // Customer watch list (Favorites) SMS toggles
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);

  useEffect(() => {
    const fetchNotifPrefs = async () => {
      setLoadingNotifPrefs(true);
      try {
        const res = await axios.get(`${PRODUCTION_URL}/users/profile`);
        const u = res.data.user;
        const prefs = {
          phoneNumber: u.phoneNumber || "",
          canReceiveIsisSms: !!u.canReceiveIsisSms,
          highTrafficSmsEnabled: !!u.highTrafficSmsEnabled,
          isisWatchScope: (u.isisWatchScope || "all") as "all" | "watchlist",
        };
        setNotifPrefs(prefs);
        setInitialNotifPrefs(prefs);
      } catch (error) {
        console.error("Error fetching notification preferences:", error);
      } finally {
        setLoadingNotifPrefs(false);
      }
    };
    fetchNotifPrefs();
  }, []);

  useEffect(() => {
    const fetchFavorites = async () => {
      setLoadingFavorites(true);
      try {
        const res = await axios.get(`${PRODUCTION_URL}/favorites?pageSize=100`);
        setFavorites(res.data.favorites || []);
      } catch (error) {
        console.error("Error fetching favorites:", error);
      } finally {
        setLoadingFavorites(false);
      }
    };
    fetchFavorites();
  }, []);

  useEffect(() => {
    if (notifPrefs.isisWatchScope !== "watchlist") return;
    const fetchIsisPickerData = async () => {
      setLoadingIsisPicker(true);
      try {
        const [linksRes, watchRes] = await Promise.all([
          axios.get(`${PRODUCTION_URL}/isis-adjacency/list`),
          axios.get(`${PRODUCTION_URL}/isis-watchlist`),
        ]);
        setAdjacencyLinks(linksRes.data.adjacencies || []);
        setIsisWatchlist(watchRes.data.watchlist || []);
      } catch (error) {
        console.error("Error fetching ISIS watch list picker data:", error);
      } finally {
        setLoadingIsisPicker(false);
      }
    };
    fetchIsisPickerData();
  }, [notifPrefs.isisWatchScope]);

  const handlePhoneChange = (value: string) => {
    setNotifPrefs((prev) => ({ ...prev, phoneNumber: value }));
    if (!value || /^255\d{9}$/.test(value)) {
      setPhoneError("");
    } else {
      setPhoneError("Format: 255XXXXXXXXX (e.g. 255712345678)");
    }
  };

  const handleSaveNotifPrefs = async () => {
    if (notifPrefs.phoneNumber && !/^255\d{9}$/.test(notifPrefs.phoneNumber)) {
      setPhoneError("Format: 255XXXXXXXXX (e.g. 255712345678)");
      return;
    }
    try {
      setSavingNotifPrefs(true);
      await axios.put(`${PRODUCTION_URL}/users/notification-preferences`, notifPrefs);
      setInitialNotifPrefs(notifPrefs);
      toast({
        title: "Notification preferences saved",
        description: "Your SMS notification settings have been updated.",
      });
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Save failed",
        description:
          error?.response?.data?.message || "Could not save notification preferences.",
        variant: "destructive",
      });
    } finally {
      setSavingNotifPrefs(false);
    }
  };

  const isIsisNodeWatched = (pointToPointIp: string) =>
    isisWatchlist.some((w) => w.pointToPointIp === pointToPointIp);

  const toggleIsisNode = async (link: AdjacencyLink) => {
    const existing = isisWatchlist.find((w) => w.pointToPointIp === link.pointToPointIp);
    // Denormalized display fields only need one representative side — the
    // actual matching key sent below (pointToPointIp) is the network key
    // that covers both sides of this physical link.
    const primarySide = link.sides[0];
    try {
      if (existing) {
        await axios.delete(`${PRODUCTION_URL}/isis-watchlist/${existing.id}`);
        setIsisWatchlist((prev) => prev.filter((w) => w.id !== existing.id));
      } else {
        const res = await axios.post(`${PRODUCTION_URL}/isis-watchlist`, {
          pointToPointIp: link.pointToPointIp,
          isisAdjacencyId: primarySide?.id,
          neighborName: primarySide?.neighborName,
          interfaceName: primarySide?.interface,
          deviceName: primarySide?.deviceName,
        });
        setIsisWatchlist((prev) => [...prev, res.data.entry]);
      }
    } catch (error: any) {
      console.error("Error updating ISIS watch list:", error);
      toast({
        title: "Error",
        description: error?.response?.data?.message || "Failed to update ISIS watch list.",
        variant: "destructive",
      });
    }
  };

  const removeIsisWatchEntry = async (entry: IsisWatchEntry) => {
    try {
      await axios.delete(`${PRODUCTION_URL}/isis-watchlist/${entry.id}`);
      setIsisWatchlist((prev) => prev.filter((w) => w.id !== entry.id));
    } catch (error) {
      console.error("Error removing ISIS watch entry:", error);
    }
  };

  const toggleFavoriteSms = async (favorite: FavoriteRow) => {
    const next = !favorite.smsAlertsEnabled;
    setFavorites((prev) =>
      prev.map((f) => (f.id === favorite.id ? { ...f, smsAlertsEnabled: next } : f))
    );
    try {
      await axios.put(`${PRODUCTION_URL}/favorites/${favorite.id}/sms-alerts`, {
        smsAlertsEnabled: next,
      });
    } catch (error) {
      console.error("Error updating favorite SMS alerts:", error);
      // revert on failure
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

  const filteredAdjacencyLinks = useMemo(() => {
    if (!isisSearch.trim()) return adjacencyLinks;
    const q = isisSearch.toLowerCase();
    return adjacencyLinks.filter(
      (l) =>
        l.label?.toLowerCase().includes(q) ||
        l.pointToPointIp?.toLowerCase().includes(q) ||
        l.sides.some(
          (s) =>
            s.deviceName?.toLowerCase().includes(q) ||
            s.neighborName?.toLowerCase().includes(q) ||
            s.interface?.toLowerCase().includes(q) ||
            s.pointToPointIp?.toLowerCase().includes(q)
        )
    );
  }, [adjacencyLinks, isisSearch]);

  // ✅ Detect if user details changed
  const isUserChanged = useMemo(() => {
    return (
      userDetails.full_name !== user?.full_name ||
      userDetails.email !== user?.email 
    );
  }, [userDetails, user]);

  // ✅ Detect if password form changed
  const isPassChanged = useMemo(() => {
    const isFilled = (
      secrety.currentPassword.trim() !== "" &&
      secrety.newPassword.trim() !== "" &&
      secrety.confirmPassword.trim() !== ""
    );
    const passwordsMatch = secrety.newPassword === secrety.confirmPassword;

    // The form is valid only if all fields are filled AND passwords match
    return isFilled && passwordsMatch;
  }, [secrety]);

  const handleChangeUserDetails = (e) => {
    setUserDetails({ ...userDetails, [e.target.name]: e.target.value });
  };

  const handleChangeSecrety = (e) => {
    const { name, value } = e.target;
    const updatedSecrety = { ...secrety, [name]: value };
    
    setSecrety(updatedSecrety);

    // 2. Check for mismatch and update error state
    if (name === "newPassword" || name === "confirmPassword") {
      const newPassword = name === "newPassword" ? value : updatedSecrety.newPassword;
      const confirmPassword = name === "confirmPassword" ? value : updatedSecrety.confirmPassword;

      if (newPassword && confirmPassword && newPassword !== confirmPassword) {
        setPasswordMismatchError(true);
      } else {
        setPasswordMismatchError(false);
      }
    }
  };

  const handleSubmitUserDetails = async (e) => {
    e.preventDefault();
    if (!isUserChanged) return;
    try {
      setLoadingUser(true);
      const res = await axios.put(`${PRODUCTION_URL}/users/profile`, {
        fullName: userDetails.full_name,
        email: userDetails.email,
      });

      const updatedUser = res.data.user;
      if (updatedUser) {
        localStorage.setItem("userData", JSON.stringify(updatedUser));
        dispatch({ type: "SIGN_IN_DATA", payload: updatedUser });
      }

      toast({
        title: "Profile updated",
        description: "Your account information has been updated.",
      });
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Update failed",
        description:
          error?.response?.data?.message ||
          "Could not update your account information.",
        variant: "destructive",
      });
    } finally {
      setLoadingUser(false);
    }
  };

  const handleSubmitSecrety = async (e) => {
    e.preventDefault();
    // Also check for explicit mismatch error before submitting
    if (!isPassChanged || passwordMismatchError) return; 

    try {
      setLoadingPass(true);
      const res = await axios.put(`${PRODUCTION_URL}/users/profile`, {
        currentPassword: secrety.currentPassword,
        password: secrety.newPassword,
      });

      const passwordChanged = res.data?.passwordChanged;

      toast({
        title: "Password updated",
        description: passwordChanged
          ? "Your password has been changed. Please log in again with your new password."
          : "Your password has been updated.",
      });

      // Log the user out so they must sign in with the new password
      logout();
      navigate("/");

      // reset fields
      setSecrety({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error: any) {
      console.error(error);

      const message = error?.response?.data?.message;

      toast({
        title: "Password update failed",
        description:
          message ||
          "Could not update your password. Please check your current password and try again.",
        variant: "destructive",
      });

      // If token is invalid or expired (including after a password change elsewhere),
      // force logout and redirect to login.
      if (error?.response?.status === 401) {
        logout();
        navigate("/");
      }
    } finally {
      setLoadingPass(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account preferences and application settings
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Account Settings (omitted for brevity) */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5" />
              Account Settings
            </CardTitle>
            <CardDescription>Update your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                name="full_name"
                value={userDetails.full_name}
                onChange={handleChangeUserDetails}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={userDetails.email}
                onChange={handleChangeUserDetails}
              />
            </div>
            <Button
              className="w-full"
              onClick={handleSubmitUserDetails}
              disabled={!isUserChanged || loadingUser}
            >
              {loadingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security
            </CardTitle>
            <CardDescription>Manage your security preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                name="currentPassword"
                type="password"
                value={secrety.currentPassword}
                onChange={handleChangeSecrety}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                name="newPassword"
                type="password"
                value={secrety.newPassword}
                onChange={handleChangeSecrety}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                value={secrety.confirmPassword}
                onChange={handleChangeSecrety}
                // Optional: add a class to visually indicate error
                className={passwordMismatchError ? "border-red-500" : ""} 
              />
              {/* 3. Conditional error message */}
              {passwordMismatchError && (
                <p className="text-sm text-red-500">
                  New password and confirmation password do not match.
                </p>
              )}
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleSubmitSecrety}
              // Disable if passwords don't match (already handled by isPassChanged, but explicit is clearer)
              disabled={!isPassChanged || loadingPass || passwordMismatchError}
            >
              {loadingPass && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Password
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Notifications */}
      <Card className="dashboard-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            Notifications
          </CardTitle>
          <CardDescription>
            Choose which SMS alerts you receive and build a watch list of the specific
            customer links and ISIS nodes you care about most.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>How this works</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 space-y-1 mt-1">
                <li>Both SMS toggles below are <strong>on by default</strong> and cover every ISIS link network-wide.</li>
                <li>
                  The <strong>ISIS alert scope</strong> switch applies to both toggles together —
                  switching it to <strong>"Only my watched nodes"</strong> replaces the network-wide
                  alerts for both ISIS link up/down <strong>and</strong> high-traffic alerts with
                  just the nodes you pick below, not both at once.
                </li>
                <li>
                  Adding a customer to your watch list (star icon, or below) with SMS alerts
                  enabled texts you when that customer's link goes <strong>down</strong> and when
                  it <strong>recovers</strong>. The same applies to watched ISIS nodes.
                </li>
                <li>A phone number is required to receive any SMS alert.</li>
              </ul>
            </AlertDescription>
          </Alert>

          {loadingNotifPrefs ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-2 max-w-sm">
                <Label htmlFor="phone-number">Phone Number (for SMS)</Label>
                <Input
                  id="phone-number"
                  placeholder="255712345678"
                  value={notifPrefs.phoneNumber}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                />
                {phoneError && <p className="text-sm text-red-500">{phoneError}</p>}
              </div>

              <Separator />

              <div className="flex items-center justify-between max-w-lg">
                <div>
                  <p className="font-medium text-sm">ISIS link up/down alerts</p>
                  <p className="text-xs text-muted-foreground">Text me when an ISIS link goes down or recovers</p>
                </div>
                <Switch
                  checked={notifPrefs.canReceiveIsisSms}
                  onCheckedChange={(checked) =>
                    setNotifPrefs((prev) => ({ ...prev, canReceiveIsisSms: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between max-w-lg">
                <div>
                  <p className="font-medium text-sm">High traffic alerts</p>
                  <p className="text-xs text-muted-foreground">Text me when a link exceeds 85% utilisation</p>
                </div>
                <Switch
                  checked={notifPrefs.highTrafficSmsEnabled}
                  onCheckedChange={(checked) =>
                    setNotifPrefs((prev) => ({ ...prev, highTrafficSmsEnabled: checked }))
                  }
                />
              </div>

              <div className="space-y-2 max-w-sm">
                <Label>ISIS alert scope</Label>
                <Select
                  value={notifPrefs.isisWatchScope}
                  onValueChange={(value: "all" | "watchlist") =>
                    setNotifPrefs((prev) => ({ ...prev, isisWatchScope: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All ISIS links (default)</SelectItem>
                    <SelectItem value="watchlist">Only my watched nodes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {notifPrefs.isisWatchScope === "watchlist" && (
                <div className="space-y-3 pt-2">
                  <Separator />
                  <div>
                    <p className="font-medium text-sm mb-1">My watched ISIS nodes</p>
                    {isisWatchlist.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No nodes watched yet — add some below.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {isisWatchlist.map((entry) => (
                          <Badge key={entry.id} variant="outline" className="flex items-center gap-1 py-1">
                            {entry.deviceName} x {entry.neighborName} ({entry.interfaceName})
                            <button onClick={() => removeIsisWatchEntry(entry)} className="ml-1">
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <Input
                    placeholder="Search device, neighbor, interface or IP..."
                    value={isisSearch}
                    onChange={(e) => setIsisSearch(e.target.value)}
                    className="max-w-sm"
                  />

                  {loadingIsisPicker ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                      {filteredAdjacencyLinks.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-3">No ISIS links found.</p>
                      ) : (
                        filteredAdjacencyLinks.map((link) => (
                          <label
                            key={link.pointToPointIp}
                            className="flex items-center gap-3 p-2 hover:bg-accent/50 cursor-pointer text-sm"
                          >
                            <Checkbox
                              checked={isIsisNodeWatched(link.pointToPointIp)}
                              onCheckedChange={() => toggleIsisNode(link)}
                            />
                            <span className="flex-1">{link.label}</span>
                            <Badge
                              variant="outline"
                              className={link.state === "Up" ? "text-success" : "text-destructive"}
                            >
                              {link.state}
                            </Badge>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <Separator />

              <div>
                <p className="font-medium text-sm mb-1">Customer watch list SMS</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Toggle which watch-listed customers text you on down/recovery. Add or remove
                  customers from the <a href="/watchlist" className="underline">Watchlist page</a>.
                </p>
                {loadingFavorites ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : favorites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    You haven't watch-listed any customers yet.
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                    {favorites.map((fav) => (
                      <div key={fav.id} className="flex items-center gap-3 p-2 text-sm">
                        <Switch
                          checked={fav.smsAlertsEnabled}
                          onCheckedChange={() => toggleFavoriteSms(fav)}
                        />
                        <span>
                          {fav.customerName}{" "}
                          <Badge variant="outline" className="ml-1">{fav.customerType}</Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex justify-start">
                <Button onClick={handleSaveNotifPrefs} disabled={!isNotifPrefsChanged || savingNotifPrefs || !!phoneError}>
                  {savingNotifPrefs && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Notification Settings
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}