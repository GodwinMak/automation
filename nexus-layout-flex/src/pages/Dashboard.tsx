import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PRODUCTION_URL } from "@/utils/Api";
import axios from "axios";
import { Server, Users, Activity, ArrowUpCircle, ArrowDownCircle, Clock, Network, Globe, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  type StatsData = {
    deviceCount: number;
    upDiaCustomerCount: number;
    downDiaCustomerCount: number;
    upIptCustomerCount: number;
    downIptCustomerCount: number;
    upSharedCustomerCount: number;
    downSharedCustomerCount: number;
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
  const diaUptimeRate = totalDiaCustomers > 0 ? (((data.upDiaCustomerCount ?? 0) / totalDiaCustomers) * 100).toFixed(1) : 0;
  const iptUptimeRate = totalIptCustomers > 0 ? (((data.upIptCustomerCount ?? 0) / totalIptCustomers) * 100).toFixed(1) : 0;
  const sharedUptimeRate = totalSharedCustomers > 0 ? (((data.upSharedCustomerCount ?? 0) / totalSharedCustomers) * 100).toFixed(1) : 0;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
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

      {/* DIA, IPT & Shared Customer Stats */}
      <div className="grid gap-6 lg:grid-cols-3">
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
      </div>

      {/* Network Overview */}
      <Card className="border border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-primary" />
            Network Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
                <p className="text-sm text-muted-foreground">All Customers</p>
                <p className="text-2xl font-bold text-foreground">{totalDiaCustomers + totalIptCustomers + totalSharedCustomers}</p>
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
