import React, { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
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
// import Analysis from "./pages/Analysis";
import IptCustomer from "./pages/IptCustomer";
import Capacity from "./pages/Capacity";
import Watchlist from "./pages/Watchlist";
import UptimeTrends from "./pages/UptimeTrends";
import ChurnAnalysis from "./pages/ChurnAnalysis";
import IptPercentileReport from "./pages/IptPercentileReport";
import DiaPercentileReport from "./pages/DiaPercentileReport";
import GponPercentileReport from "./pages/GponPercentileReport";
import CombinedPercentileReport from "./pages/CombinedPercentileReport";

const queryClient = new QueryClient();

const App = () => {
  const [connection, setConnection] = useState(null);

  const handleCloseTerminal = () => {
    setConnection(null);
  };

  return (
    <ThemeProvider defaultTheme="dark" storageKey="nexus-ui-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            
            {/* Conditional route for /switches */}
            {connection ? (
              // If connected, render the WebTerminal without the Layout
              <Route path="/switches" element={<WebTerminal connection={connection} onClose={handleCloseTerminal}  />} />
            ) : (
              // If not connected, render the Switches page within the Layout
              <Route path="/switches" element={<Layout />} >
                <Route index element={<Switches onOpen={setConnection} />} />
              </Route>
            )}
            
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/dia-customer" element={<DiaCustomer />} />
              <Route path="/ipt-customer" element={<IptCustomer />} />
              <Route path="/shared-customer" element={<SharedCustomer />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/viewcustomer" element={<ViewDiaCutomer/>} />
              <Route path="/view-ipt-customer" element={<ViewIptCustomer/>} />
              <Route path="/view-shared-customer" element={<ViewSharedCustomer/>} />
              <Route path="/view-graph" element={<ViewGraph />} />
              {/* <Route path="/analysis" element={<Analysis/>}/> */}
              <Route path="/capacity" element={<Capacity/>}/>
              <Route path="/watchlist" element={<Watchlist/>}/>
              <Route path="/uptime-trends" element={<UptimeTrends/>}/>
              <Route path="/churn-analysis" element={<ChurnAnalysis/>}/>
              <Route path="/ipt-report" element={<IptPercentileReport/>}/>
              <Route path="/dia-report" element={<DiaPercentileReport/>}/>
              <Route path="/gpon-report" element={<GponPercentileReport/>}/>
              <Route path="/combined-report" element={<CombinedPercentileReport/>}/>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

export default App;