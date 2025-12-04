import React, { useEffect, useState, useRef } from "react";
import {
  Bell,
  User,
  RefreshCw,
  CheckCircle,
  Upload,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuthContext } from "@/hooks/useAuthContext";
import { useNavigate } from "react-router-dom";
import io from "socket.io-client";
import { PRODUCTION_URL } from "@/utils/Api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GlobalSearch } from "@/components/GlobalSearch";
// Define the possible status types for clarity and consistency
const UPDATE_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  FINISHED: "finished",
};

export function Navbar() {
  const user = JSON.parse(localStorage.getItem("userData"));
  const { dispatch } = useAuthContext();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  // Modal: File upload for client_db_billing_file
  const [openUploadModal, setOpenUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const socketRef = useRef(null);
  const timeoutRef = useRef(null); // Ref to store the timeout for the 'finished' state

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // 🎯 State to track the update process
  const [updateStatus, setUpdateStatus] = useState(UPDATE_STATUS.IDLE);

  useEffect(() => {
    const socket = io(`${PRODUCTION_URL}`);
    socketRef.current = socket;

    // Create an Audio instance for the notification sound
    const audio = new Audio("/notification.mp3");

    socket.on("linkDownAlert", (newNotification) => {
      console.log("Received new notification:", newNotification);

      setNotifications((prevNotifications) => [
        newNotification,
        ...prevNotifications,
      ]);

      setUnreadCount((prevCount) => prevCount + 1);

      audio.play().catch((error) => {
        console.error("Failed to play sound:", error);
      });
    });

    // 🎯 Listener for the update completion from the server
    socket.on("diaUpdateComplete", () => {
      // Clear any existing timeout before setting a new one
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // 1. Show 'ended' state (Checkmark)
      setUpdateStatus(UPDATE_STATUS.FINISHED);
      console.log("DIA update completed.");

      // 2. Set timeout to revert to IDLE state after 3 seconds
      timeoutRef.current = setTimeout(() => {
        setUpdateStatus(UPDATE_STATUS.IDLE);
      }, 3000);
    });

    return () => {
      socket.disconnect();
      // Cleanup timeout on component unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("userToken");
    localStorage.removeItem("userData");
    dispatch({ type: "SIGN_OUT" });
    navigate("/");
  };

  const handleNotificationOpen = (isOpen) => {
    if (isOpen) {
      setUnreadCount(0);
    }
  };

  // 🎯 Function to manually call the DIA update
  const handleManualDiaUpdate = () => {
    if (socketRef.current && updateStatus === UPDATE_STATUS.IDLE) {
      // 1. Show 'started' state immediately
      setUpdateStatus(UPDATE_STATUS.RUNNING);

      console.log("Emitting 'manualDiaUpdate' to server.");
      socketRef.current.emit("manualDiaUpdate");
    }
  };

  // 🎯 Helper function to render the correct icon
  const renderRefreshIcon = () => {
    switch (updateStatus) {
      case UPDATE_STATUS.RUNNING:
        // Spinning icon for 'running' (Started)
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      case UPDATE_STATUS.FINISHED:
        // Success icon for 'finished' (Ended)
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case UPDATE_STATUS.IDLE:
      default:
        return <RefreshCw className="h-4 w-4" />;
    }
  };

  // 🎯 Helper function for button title
  const getButtonTitle = () => {
    switch (updateStatus) {
      case UPDATE_STATUS.RUNNING:
        return "DIA Update Running...";
      case UPDATE_STATUS.FINISHED:
        return "DIA Update Finished!";
      case UPDATE_STATUS.IDLE:
      default:
        return "Manually refresh DIA data";
    }
  };

  const handleBillingFileUpload = async () => {
    if (!selectedFile) return alert("Please select a file");

    try {
      setUploading(true);

      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch(`${PRODUCTION_URL}/client/upload`, {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (res.ok) {
        alert("Upload successful!");
        setOpenUploadModal(false); // ✅ Auto-close modal
        setSelectedFile(null);
      } else {
        alert(result.error || "Upload failed");
      }
    } catch (err) {
      alert("Server error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="flex h-14 items-center px-4 lg:px-6">
        <SidebarTrigger className="mr-3" />

        {/* Global Search */}
        <div className="flex-1 flex justify-center px-4">
          <GlobalSearch />
        </div>

        <div className="flex items-center gap-2">
          {/* Theme Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="relative h-9 w-9 hover:bg-accent transition-colors"
                title="Toggle theme"
              >
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="mr-2 h-4 w-4" />
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="mr-2 h-4 w-4" />
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor className="mr-2 h-4 w-4" />
                System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Manual DIA Update Button with status indicators */}
          <Button
            variant="ghost"
            size="sm"
            className="relative h-9 w-9 hover:bg-accent transition-colors"
            onClick={handleManualDiaUpdate}
            disabled={updateStatus === UPDATE_STATUS.RUNNING}
            title={getButtonTitle()}
          >
            {renderRefreshIcon()}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="relative h-9 w-9 hover:bg-accent transition-colors"
            onClick={() => setOpenUploadModal(true)}
            title="Upload Billing Excel"
          >
            <Upload className="h-4 w-4" />
          </Button>

          {/* Notification Bell */}
          <DropdownMenu onOpenChange={handleNotificationOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="relative h-9 w-9 hover:bg-accent transition-colors"
              >
                <Bell className="h-4 w-4" />
                {/* Show badge only if there are unread notifications */}
                {unreadCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full p-0 text-[10px] font-semibold leading-none"
                  >
                    {unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80" align="end">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length > 0 ? (
                notifications.map((notif, index) => (
                  <DropdownMenuItem
                    key={index}
                    className="flex flex-col items-start gap-1"
                  >
                    <p className="font-semibold text-destructive">
                      🚨 Link Down: {notif.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {notif.interface} on {notif.switchName}
                    </p>
                    <p className="text-xs text-muted-foreground self-end">
                      {new Date(notif.timestamp).toLocaleString()}
                    </p>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem>No new notifications</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Profile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="relative h-9 w-9 hover:bg-accent transition-colors"
              >
                <User className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {user?.username}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => navigate("/settings")}
              >
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive"
                onClick={handleLogout}
              >
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={openUploadModal} onOpenChange={setOpenUploadModal}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Upload Billing File</DialogTitle>
                <DialogDescription>
                  Select an Excel file (.xlsx) to upload billing data in bulk.
                </DialogDescription>
              </DialogHeader>

              {/* File Input */}
              <div className="flex flex-col gap-4">
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                />

                {/* Upload Button */}
                <Button
                  disabled={uploading || !selectedFile}
                  onClick={handleBillingFileUpload}
                >
                  {uploading ? "Uploading..." : "Upload"}
                </Button>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setOpenUploadModal(false)}
                >
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  );
}
