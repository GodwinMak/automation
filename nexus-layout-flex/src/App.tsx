import React, { useState } from "react";
import { MessageCircle } from "lucide-react";
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
import SwitchConfigurations from "./pages/SwitchConfigurations";
import SwitchMap from "./pages/SwitchMap";
import IsisImpactAnalyzer from "./pages/IsisImpactAnalyzer";
import L3VPNCustomer from "./pages/L3VPNCustomer";
import ViewL3VPNCustomer from "./pages/ViewL3VPNCustomer";
import ViewFTTHCustomer from "./pages/ViewFTTHCustomer";
import FTTHCustomer from "./pages/FTTHCustomer";
import FTTHReports from "./pages/FTTHReports";
import SmsBroadcast from "./pages/SmsBroadcast";

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
              {/* Msaada Chatbot floating button — visible on all pages */}
              <a
                href="https://chatbot.liquidmatics.co.tz"
                target="_blank"
                rel="noopener noreferrer"
                title="Msaada - AI Assistant"
                className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-1.5 group"
              >
                <div className="relative bg-gradient-to-br from-emerald-400 to-teal-600 hover:from-emerald-300 hover:to-teal-500 text-white rounded-full w-16 h-16 flex items-center justify-center shadow-xl shadow-teal-900/60 transition-all duration-200 group-hover:scale-110 group-hover:shadow-teal-500/50">
                  {/* Pulse ring */}
                  <span className="absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-30 animate-ping" />
                  <MessageCircle className="h-7 w-7 drop-shadow" />
                </div>
                <span className="bg-teal-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full shadow tracking-wide group-hover:bg-teal-500 transition-colors">
                  Msaada
                </span>
              </a>
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
                    path="/l3vpn-customer"
                    element={
                      <ProtectedRoute>
                        <L3VPNCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/view-l3vpn-customer"
                    element={
                      <ProtectedRoute>
                        <ViewL3VPNCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/view-ftth-customer"
                    element={
                      <ProtectedRoute>
                        <ViewFTTHCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/ftth-customer"
                    element={
                      <ProtectedRoute>
                        <FTTHCustomer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/ftth-reports"
                    element={
                      <ProtectedRoute>
                        <FTTHReports />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/sms-broadcast"
                    element={
                      <ProtectedRoute>
                        <SmsBroadcast />
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
                  <Route
                    path="/switch-configurations"
                    element={
                      <ProtectedRoute requiredPermission="canConfigureCustomers">
                        <SwitchConfigurations />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/switch-map"
                    element={
                      <ProtectedRoute>
                        <SwitchMap />
                      </ProtectedRoute>
                    }
                  />

                  <Route path="*" element={<NotFound />} />
                </Route>
                <Route
                    path="/isis-impact"
                    element={
                      <ProtectedRoute>
                        <IsisImpactAnalyzer />
                      </ProtectedRoute>
                    }
                  />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

export default App;
