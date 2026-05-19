import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PRODUCTION_URL } from "@/utils/Api";
import axios from "axios";
import { Server, Users, Activity, ArrowUpCircle, ArrowDownCircle, Clock, Network, Globe, Share2, Layers, Wifi, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import MLInsights from "@/components/MLInsights";

export default function Dashboard() {
  type StatsData = {
    deviceCount: number;
    upDiaCustomerCount: number;
    downDiaCustomerCount: number;
    upIptCustomerCount: number;
    downIptCustomerCount: number;
    upSharedCustomerCount: number;
    downSharedCustomerCount: number;
    upL3VPNCustomerCount: number;
    downL3VPNCustomerCount: number;
    upFTTHCustomerCount: number;
    downFTTHCustomerCount: number;
    expiredUpFTTHCount: number;
    expiredDownFTTHCount: number;
    activeUpFTTHCount: number;
    activeDownFTTHCount: number;
    temporaryUpgradesCount: number;
    permanentUpgradesCount: number;
  };

  const [data, setData] = useState<StatsData>({
    deviceCount: 0,
    upDiaCustomerCount: 0,
    downDiaCustomerCount: 0,
    upIptCustomerCount: 0,
    downIptCustomerCount: 0,
    upSharedCustomerCount: 0,
    downSharedCustomerCount: 0,
    upL3VPNCustomerCount: 0,
    downL3VPNCustomerCount: 0,
    upFTTHCustomerCount: 0,
    downFTTHCustomerCount: 0,
    expiredUpFTTHCount: 0,
    expiredDownFTTHCount: 0,
    activeUpFTTHCount: 0,
    activeDownFTTHCount: 0,
    temporaryUpgradesCount: 0,
    permanentUpgradesCount: 0,
  });

  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(`${PRODUCTION_URL}/status`);
        setData(response.data);
      } catch (error) {
        console.log(error);
      }
    };
    fetchData();
  }, []);

  const diaStats = [
    {
      title: "DIA Customers UP",
      value: data.upDiaCustomerCount ?? 0,
      icon: ArrowUpCircle,
      type: "up",
      route: "/dia-customer",
      color: "text-success",
      bgColor: "bg-success/10",
      borderColor: "border-success/20",
    },
    {
      title: "DIA Customers DOWN",
      value: data.downDiaCustomerCount ?? 0,
      icon: ArrowDownCircle,
      type: "down",
      route: "/dia-customer",
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      borderColor: "border-destructive/20",
    },
  ];

  const iptStats = [
    {
      title: "IPT Customers UP",
      value: data.upIptCustomerCount ?? 0,
      icon: ArrowUpCircle,
      type: "up",
      route: "/ipt-customer",
      color: "text-success",
      bgColor: "bg-success/10",
      borderColor: "border-success/20",
    },
    {
      title: "IPT Customers DOWN",
      value: data.downIptCustomerCount ?? 0,
      icon: ArrowDownCircle,
      type: "down",
      route: "/ipt-customer",
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      borderColor: "border-destructive/20",
    },
  ];

  const sharedStats = [
    {
      title: "Shared Customers UP",
      value: data.upSharedCustomerCount ?? 0,
      icon: ArrowUpCircle,
      type: "up",
      route: "/shared-customer",
      color: "text-success",
      bgColor: "bg-success/10",
      borderColor: "border-success/20",
    },
    {
      title: "Shared Customers DOWN",
      value: data.downSharedCustomerCount ?? 0,
      icon: ArrowDownCircle,
      type: "down",
      route: "/shared-customer",
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      borderColor: "border-destructive/20",
    },
  ];

  const l3vpnStats = [
    {
      title: "L3VPN Customers UP",
      value: data.upL3VPNCustomerCount ?? 0,
      icon: ArrowUpCircle,
      type: "up",
      route: "/l3vpn-customer",
      color: "text-success",
      bgColor: "bg-success/10",
      borderColor: "border-success/20",
    },
    {
      title: "L3VPN Customers DOWN",
      value: data.downL3VPNCustomerCount ?? 0,
      icon: ArrowDownCircle,
      type: "down",
      route: "/l3vpn-customer",
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      borderColor: "border-destructive/20",
    },
  ];

  const generalStats = [
    {
      title: "Devices Available",
      value: data.deviceCount ?? 0,
      icon: Server,
      type: null,
      route: null,
      color: "text-primary",
      bgColor: "bg-primary/10",
      borderColor: "border-primary/20",
    },
    {
      title: "Temporary Upgrades",
      value: data.temporaryUpgradesCount ?? 0,
      icon: Clock,
      type: "temporary",
      route: "/dia-customer",
      color: "text-warning",
      bgColor: "bg-warning/10",
      borderColor: "border-warning/20",
    },
  ];

  const handleCardClick = (route: string | null, type: string | null) => {
    if (route && type) {
      navigate(route, { state: { filterType: type } });
    }
  };

  const StatCard = ({ stat, index }: { stat: any; index: number }) => (
    <Card
      onClick={() => handleCardClick(stat.route, stat.type)}
      className={`group relative overflow-hidden border ${stat.borderColor} bg-card hover:shadow-lg transition-all duration-300 ${stat.route ? 'cursor-pointer hover:-translate-y-1' : ''}`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className={`absolute inset-0 ${stat.bgColor} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
      
      <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
          {stat.title}
        </CardTitle>
        <div className={`p-2 rounded-lg ${stat.bgColor}`}>
          <stat.icon className={`h-5 w-5 ${stat.color}`} />
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className={`text-3xl font-bold ${stat.color}`}>
          {stat.value.toLocaleString()}
        </div>
        {stat.type && (
          <p className="text-xs text-muted-foreground mt-1">
            Click to view details →
          </p>
        )}
      </CardContent>
    </Card>
  );

  const totalDiaCustomers = (data.upDiaCustomerCount ?? 0) + (data.downDiaCustomerCount ?? 0);
  const totalIptCustomers = (data.upIptCustomerCount ?? 0) + (data.downIptCustomerCount ?? 0);
  const totalSharedCustomers = (data.upSharedCustomerCount ?? 0) + (data.downSharedCustomerCount ?? 0);
  const totalL3VPNCustomers = (data.upL3VPNCustomerCount ?? 0) + (data.downL3VPNCustomerCount ?? 0);
  const totalFTTHCustomers = (data.upFTTHCustomerCount ?? 0) + (data.downFTTHCustomerCount ?? 0);
  const diaUptimeRate = totalDiaCustomers > 0 ? (((data.upDiaCustomerCount ?? 0) / totalDiaCustomers) * 100).toFixed(1) : 0;
  const iptUptimeRate = totalIptCustomers > 0 ? (((data.upIptCustomerCount ?? 0) / totalIptCustomers) * 100).toFixed(1) : 0;
  const sharedUptimeRate = totalSharedCustomers > 0 ? (((data.upSharedCustomerCount ?? 0) / totalSharedCustomers) * 100).toFixed(1) : 0;
  const l3vpnUptimeRate = totalL3VPNCustomers > 0 ? (((data.upL3VPNCustomerCount ?? 0) / totalL3VPNCustomers) * 100).toFixed(1) : 0;
  const ftthUptimeRate = totalFTTHCustomers > 0 ? (((data.upFTTHCustomerCount ?? 0) / totalFTTHCustomers) * 100).toFixed(1) : 0;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
        <h3 className="font-bold tracking-tight  text-foreground">
        Network Overview
        </h3>
        <p className="text-muted-foreground">
          Welcome back! Here's what's happening with your network services today.
        </p>
      </div>

      {/* General Stats */}
      <div className="grid gap-6 md:grid-cols-2">
        {generalStats.map((stat, index) => (
          <StatCard key={stat.title} stat={stat} index={index} />
        ))}
      </div>
      {/* AI Insights Section */}
      {/* <MLInsights /> */}

      {/* DIA, IPT, Shared & L3VPN Customer Stats */}
      <div className="grid gap-6 lg:grid-cols-4">
        {/* DIA Customers Section */}
        <Card className="border border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="p-2 rounded-lg bg-primary/10">
                <Network className="h-5 w-5 text-primary" />
              </div>
              DIA Customers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {diaStats.map((stat, index) => (
                <div
                  key={stat.title}
                  onClick={() => handleCardClick(stat.route, stat.type)}
                  className={`p-4 rounded-xl border ${stat.borderColor} ${stat.bgColor} cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    <span className={`text-2xl font-bold ${stat.color}`}>
                      {stat.value.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                </div>
              ))}
            </div>
            
            {/* DIA Progress Bar */}
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total: {totalDiaCustomers}</span>
                <span className="text-success font-medium">Uptime: {diaUptimeRate}%</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden flex">
                <div 
                  className="h-full bg-success transition-all duration-500"
                  style={{ width: `${diaUptimeRate}%` }}
                />
                <div 
                  className="h-full bg-destructive transition-all duration-500"
                  style={{ width: `${100 - Number(diaUptimeRate)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* IPT Customers Section */}
        <Card className="border border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="p-2 rounded-lg bg-primary/10">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              IPT Customers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {iptStats.map((stat, index) => (
                <div
                  key={stat.title}
                  onClick={() => handleCardClick(stat.route, stat.type)}
                  className={`p-4 rounded-xl border ${stat.borderColor} ${stat.bgColor} cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    <span className={`text-2xl font-bold ${stat.color}`}>
                      {stat.value.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                </div>
              ))}
            </div>
            
            {/* IPT Progress Bar */}
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total: {totalIptCustomers}</span>
                <span className="text-success font-medium">Uptime: {iptUptimeRate}%</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden flex">
                <div 
                  className="h-full bg-success transition-all duration-500"
                  style={{ width: `${iptUptimeRate}%` }}
                />
                <div 
                  className="h-full bg-destructive transition-all duration-500"
                  style={{ width: `${100 - Number(iptUptimeRate)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Shared Customers Section */}
        <Card className="border border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="p-2 rounded-lg bg-primary/10">
                <Share2 className="h-5 w-5 text-primary" />
              </div>
              Shared Customers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {sharedStats.map((stat, index) => (
                <div
                  key={stat.title}
                  onClick={() => handleCardClick(stat.route, stat.type)}
                  className={`p-4 rounded-xl border ${stat.borderColor} ${stat.bgColor} cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    <span className={`text-2xl font-bold ${stat.color}`}>
                      {stat.value.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                </div>
              ))}
            </div>
            
            {/* Shared Progress Bar */}
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total: {totalSharedCustomers}</span>
                <span className="text-success font-medium">Uptime: {sharedUptimeRate}%</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden flex">
                <div 
                  className="h-full bg-success transition-all duration-500"
                  style={{ width: `${sharedUptimeRate}%` }}
                />
                <div 
                  className="h-full bg-destructive transition-all duration-500"
                  style={{ width: `${100 - Number(sharedUptimeRate)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* L3VPN Customers Section */}
        <Card className="border border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="p-2 rounded-lg bg-primary/10">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              L3VPN Customers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {l3vpnStats.map((stat, index) => (
                <div
                  key={stat.title}
                  onClick={() => handleCardClick(stat.route, stat.type)}
                  className={`p-4 rounded-xl border ${stat.borderColor} ${stat.bgColor} cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    <span className={`text-2xl font-bold ${stat.color}`}>
                      {stat.value.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                </div>
              ))}
            </div>

            {/* L3VPN Progress Bar */}
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total: {totalL3VPNCustomers}</span>
                <span className="text-success font-medium">Uptime: {l3vpnUptimeRate}%</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden flex">
                <div
                  className="h-full bg-success transition-all duration-500"
                  style={{ width: `${l3vpnUptimeRate}%` }}
                />
                <div
                  className="h-full bg-destructive transition-all duration-500"
                  style={{ width: `${100 - Number(l3vpnUptimeRate)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FTTH Customer Stats */}
      <div className="grid gap-6 lg:grid-cols-1">
        <Card className="border border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="p-2 rounded-lg bg-teal-500/10">
                <Wifi className="h-5 w-5 text-teal-500" />
              </div>
              FTTH Subscribers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div
                onClick={() => navigate("/ftth-customer", { state: { filterType: "up" } })}
                className="p-4 rounded-xl border border-success/20 bg-success/10 cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between mb-2">
                  <ArrowUpCircle className="h-5 w-5 text-success" />
                  <span className="text-2xl font-bold text-success">
                    {(data.upFTTHCustomerCount ?? 0).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">FTTH Subscribers UP</p>
              </div>
              <div
                onClick={() => navigate("/ftth-customer", { state: { filterType: "down" } })}
                className="p-4 rounded-xl border border-destructive/20 bg-destructive/10 cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between mb-2">
                  <ArrowDownCircle className="h-5 w-5 text-destructive" />
                  <span className="text-2xl font-bold text-destructive">
                    {(data.downFTTHCustomerCount ?? 0).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">FTTH Subscribers DOWN</p>
              </div>

              {/* Expired */}
              <div
                onClick={() => navigate("/ftth-customer", { state: { expiryFilter: "expired" } })}
                className="p-4 rounded-xl border border-orange-500/20 bg-orange-500/10 cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between mb-2">
                  <WifiOff className="h-5 w-5 text-orange-500" />
                  <span className="text-2xl font-bold text-orange-500">
                    {((data.expiredUpFTTHCount ?? 0) + (data.expiredDownFTTHCount ?? 0)).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Expired Subscribers</p>
                <p className="text-xs text-orange-400 mt-1">
                  {(data.expiredUpFTTHCount ?? 0)} up &nbsp;·&nbsp; {(data.expiredDownFTTHCount ?? 0)} down
                </p>
              </div>

              {/* Not Expired */}
              <div
                onClick={() => navigate("/ftth-customer", { state: { expiryFilter: "active" } })}
                className="p-4 rounded-xl border border-teal-500/20 bg-teal-500/10 cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between mb-2">
                  <Wifi className="h-5 w-5 text-teal-500" />
                  <span className="text-2xl font-bold text-teal-500">
                    {((data.activeUpFTTHCount ?? 0) + (data.activeDownFTTHCount ?? 0)).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Active (Not Expired)</p>
                <p className="text-xs text-teal-400 mt-1">
                  {(data.activeUpFTTHCount ?? 0)} up &nbsp;·&nbsp; {(data.activeDownFTTHCount ?? 0)} down
                </p>
              </div>

              {/* Progress bar — spans full width */}
              <div className="p-4 rounded-xl border border-border bg-muted/50 md:col-span-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total: {totalFTTHCustomers}</span>
                    <span className="text-teal-500 font-medium">Online: {ftthUptimeRate}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-muted overflow-hidden flex">
                    <div
                      className="h-full bg-teal-500 transition-all duration-500"
                      style={{ width: `${ftthUptimeRate}%` }}
                    />
                    <div
                      className="h-full bg-destructive transition-all duration-500"
                      style={{ width: `${100 - Number(ftthUptimeRate)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Network Overview */}
      <Card className="border border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-primary" />
            Customer Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border">
              <div>
                <p className="text-sm text-muted-foreground">Total DIA</p>
                <p className="text-2xl font-bold text-foreground">{totalDiaCustomers}</p>
              </div>
              <Network className="h-8 w-8 text-primary/50" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border">
              <div>
                <p className="text-sm text-muted-foreground">Total IPT</p>
                <p className="text-2xl font-bold text-foreground">{totalIptCustomers}</p>
              </div>
              <Globe className="h-8 w-8 text-primary/50" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border">
              <div>
                <p className="text-sm text-muted-foreground">Total Shared</p>
                <p className="text-2xl font-bold text-foreground">{totalSharedCustomers}</p>
              </div>
              <Share2 className="h-8 w-8 text-primary/50" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border">
              <div>
                <p className="text-sm text-muted-foreground">Total L3VPN</p>
                <p className="text-2xl font-bold text-foreground">{totalL3VPNCustomers}</p>
              </div>
              <Layers className="h-8 w-8 text-primary/50" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border">
              <div>
                <p className="text-sm text-muted-foreground">Total FTTH</p>
                <p className="text-2xl font-bold text-teal-500">{totalFTTHCustomers}</p>
              </div>
              <Wifi className="h-8 w-8 text-teal-500/50" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border">
              <div>
                <p className="text-sm text-muted-foreground">All Customers</p>
                <p className="text-2xl font-bold text-foreground">{totalDiaCustomers + totalIptCustomers + totalSharedCustomers + totalL3VPNCustomers + totalFTTHCustomers}</p>
              </div>
              <Users className="h-8 w-8 text-primary/50" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border">
              <div>
                <p className="text-sm text-muted-foreground">Active Upgrades</p>
                <p className="text-2xl font-bold text-warning">{data.temporaryUpgradesCount ?? 0}</p>
              </div>
              <Clock className="h-8 w-8 text-warning/50" />
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              Last updated: {new Date().toLocaleTimeString()}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
