import React, { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/Context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import { Layout } from "@/components/Layout";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import Switches from "./pages/Swithches";
import WebTerminal from "./pages/Terminal";
import DiaCustomer from "./pages/DiaCustomer";
import ViewDiaCutomer from "./pages/ViewDiaCutomer";
import ViewIptCustomer from "./pages/ViewIptCustomer";
import SharedCustomer from "./pages/SharedCustomer";
import ViewSharedCustomer from "./pages/ViewSharedCustomer";
import ViewGraph from "./pages/ViewGraph";
import IptCustomer from "./pages/IptCustomer";
import Capacity from "./pages/Capacity";
import Watchlist from "./pages/Watchlist";
import UptimeTrends from "./pages/UptimeTrends";
import ChurnAnalysis from "./pages/ChurnAnalysis";
import IptPercentileReport from "./pages/IptPercentileReport";
import DiaPercentileReport from "./pages/DiaPercentileReport";
import GponPercentileReport from "./pages/GponPercentileReport";
import CombinedPercentileReport from "./pages/CombinedPercentileReport";
import NonTagDIA from "./pages/NonTagDIA";
import WithTagDIA from "./pages/WithTagDIA";
import UserManagement from "./pages/UserManagement";
import DiaOverusageReport from "./pages/DiaOverusageReport";
import PitchForUpgrade from "./pages/PitchForUpgrade";

const queryClient = new QueryClient();

const App = () => {
  const [connection, setConnection] = useState(null);

  const handleCloseTerminal = () => {
    setConnection(null);
  };

  return (
    <ThemeProvider defaultTheme="dark" storageKey="nexus-ui-theme">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                {/* Public route - Login */}
                <Route path="/" element={<Login />} />

                {/* Conditional route for /switches */}
                {connection ? (
                  <Route
                    path="/switches"
                    element={
                      <WebTerminal connection={connection} onClose={handleCloseTerminal} />
                    }
                  />
                ) : (
                  <Route path="/switches" element={<Layout />}>
                    <Route
                      index
                      element={
                        <ProtectedRoute>
                          <Switches onOpen={setConnection} />
                        </ProtectedRoute>
                      }
                    />
                  </Route>
                )}

                {/* Protected routes with Layout */}
                <Route element={<Layout />}>
                  {/* General access routes */}
                  <Route
                    path="/dashboard"
                    element={
                      <ProtectedRoute>
                        <Dashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dia-customer"
                    element={
                      <ProtectedRoute>
                        <DiaCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/ipt-customer"
                    element={
                      <ProtectedRoute>
                        <IptCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/shared-customer"
                    element={
                      <ProtectedRoute>
                        <SharedCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute>
                        <Settings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/viewcustomer"
                    element={
                      <ProtectedRoute>
                        <ViewDiaCutomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/view-ipt-customer"
                    element={
                      <ProtectedRoute>
                        <ViewIptCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/view-shared-customer"
                    element={
                      <ProtectedRoute>
                        <ViewSharedCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/view-graph"
                    element={
                      <ProtectedRoute>
                        <ViewGraph />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/watchlist"
                    element={
                      <ProtectedRoute>
                        <Watchlist />
                      </ProtectedRoute>
                    }
                  />

                  {/* Restricted routes - Admin only */}
                  <Route
                    path="/user-management"
                    element={
                      <ProtectedRoute requiredPermission="canManageUsers">
                        <UserManagement />
                      </ProtectedRoute>
                    }
                  />

                  {/* Restricted routes - Not for Customer Relation */}
                  <Route
                    path="/capacity"
                    element={
                      <ProtectedRoute requiredPermission="canViewCapacity">
                        <Capacity />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dia-overusage-report"
                    element={
                      <ProtectedRoute requiredPermission="canViewCapacity">
                        <DiaOverusageReport />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/pitch-for-upgrade"
                    element={
                      <ProtectedRoute requiredPermission="canViewCapacity">
                        <PitchForUpgrade />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/uptime-trends"
                    element={
                      <ProtectedRoute requiredPermission="canViewUptimeTrends">
                        <UptimeTrends />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/churn-analysis"
                    element={
                      <ProtectedRoute requiredPermission="canViewChurnAnalysis">
                        <ChurnAnalysis />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/ipt-report"
                    element={
                      <ProtectedRoute requiredPermission="canView95thReport">
                        <IptPercentileReport />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dia-report"
                    element={
                      <ProtectedRoute requiredPermission="canView95thReport">
                        <DiaPercentileReport />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/gpon-report"
                    element={
                      <ProtectedRoute requiredPermission="canView95thReport">
                        <GponPercentileReport />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/combined-report"
                    element={
                      <ProtectedRoute requiredPermission="canView95thReport">
                        <CombinedPercentileReport />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/non-tag-dia"
                    element={
                      <ProtectedRoute requiredPermission="canConfigureCustomers">
                        <NonTagDIA />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/with-tag-dia"
                    element={
                      <ProtectedRoute requiredPermission="canConfigureCustomers">
                        <WithTagDIA />
                      </ProtectedRoute>
                    }
                  />

                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

export default App;
