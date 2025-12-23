import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  TrendingUp,
  Activity,
  Brain,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";

interface CustomerMLAnalysisProps {
  customerId: string;
  customerType: "DIA" | "IPT" | "Shared";
  customerName: string;
  switchName?: string;
  interfaceName?: string;
  upMbps?: number;  // Customer's configured upload capacity
  downMbps?: number; // Customer's configured download capacity
}

interface AnomalyResult {
  status: string;
  total_points: number;
  anomaly_count: number;
  health_score: number;
  health_status: string;
  anomalies: any[];
  summary: {
    avg_input: number;
    avg_output: number;
    max_input: number;
    max_output: number;
    current_input: number;
    current_output: number;
  };
  // Flatline detection
  flatline_detected?: boolean;
  flatline_message?: string;
  flatline_directions?: string[];
  input_flatline?: boolean;
  output_flatline?: boolean;
  avg_utilization?: number;
  max_utilization?: number;
  input_utilization?: number;
  output_utilization?: number;
  capacity_threshold?: number;
  capacity_threshold_formatted?: string;
  time_at_capacity_pct?: number;
  input_time_at_capacity_pct?: number;
  output_time_at_capacity_pct?: number;
  points_at_capacity?: number;
  input_points_at_capacity?: number;
  output_points_at_capacity?: number;
  flatline_threshold_formatted?: string;
}

interface ForecastResult {
  customer_id: string;
  forecast: {
    predicted_p95: number;
    predicted_p95_formatted: string;
    trend: string;
    growth_rate_percent: number;
  };
  capacity: {
    current: number;
    current_formatted: string;
    recommended: number;
    recommended_formatted: string;
    needs_upgrade: boolean;
    urgency: string;
  };
  message: string;
}

const CustomerMLAnalysis: React.FC<CustomerMLAnalysisProps> = ({
  customerId,
  customerType,
  customerName,
  switchName,
  interfaceName,
  upMbps,
  downMbps,
}) => {
  // Calculate capacity in bps (Mbps * 1,000,000) with 10% buffer
  const capacityBuffer = 1.1; // 110% of configured capacity
  const upCapacityBps = upMbps ? upMbps * 1e6 * capacityBuffer : undefined;
  const downCapacityBps = downMbps ? downMbps * 1e6 * capacityBuffer : undefined;
  const [anomalyResult, setAnomalyResult] = useState<AnomalyResult | null>(null);
  const [forecastResult, setForecastResult] = useState<ForecastResult | null>(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [anomalyError, setAnomalyError] = useState<string | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);

  const analyzeAnomalies = async () => {
    setAnomalyLoading(true);
    setAnomalyError(null);
    try {
      const response = await axios.get(
        `${PRODUCTION_URL}/ml/analyze/customer/${customerId}`,
        { 
          params: { 
            customerType, 
            hours: 24,
            upCapacity: upCapacityBps,
            downCapacity: downCapacityBps
          } 
        }
      );
      setAnomalyResult(response.data);
    } catch (err: any) {
      setAnomalyError(err.response?.data?.message || "Failed to analyze traffic");
    } finally {
      setAnomalyLoading(false);
    }
  };

  const forecastP95 = async () => {
    setForecastLoading(true);
    setForecastError(null);
    try {
      const response = await axios.get(
        `${PRODUCTION_URL}/ml/forecast/customer/${customerId}`,
        { params: { customerType } }
      );
      setForecastResult(response.data);
    } catch (err: any) {
      setForecastError(err.response?.data?.message || "Failed to forecast P95");
    } finally {
      setForecastLoading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} Gbps`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} Mbps`;
    if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} Kbps`;
    return `${bytes.toFixed(2)} bps`;
  };

  const getHealthColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "text-green-500";
      case "warning":
        return "text-yellow-500";
      case "critical":
        return "text-red-500";
      default:
        return "text-gray-500";
    }
  };

  const getHealthIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case "critical":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Activity className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-purple-500" />
        <h3 className="text-lg font-semibold">AI Analysis</h3>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Anomaly Detection Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Traffic Anomaly Detection
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={analyzeAnomalies}
                disabled={anomalyLoading}
              >
                {anomalyLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
            <CardDescription>
              Detect unusual traffic patterns in real-time
            </CardDescription>
          </CardHeader>
          <CardContent>
            {anomalyError ? (
              <div className="text-red-500 text-sm">{anomalyError}</div>
            ) : anomalyResult ? (
              <div className="space-y-3">
                {/* Health Score */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Health Score</span>
                  <div className="flex items-center gap-2">
                    {getHealthIcon(anomalyResult.health_status)}
                    <span className={`font-bold ${getHealthColor(anomalyResult.health_status)}`}>
                      {anomalyResult.health_score}%
                    </span>
                  </div>
                </div>

                {/* Anomalies Count */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Anomalies Found</span>
                  <Badge variant={anomalyResult.anomaly_count > 0 ? "destructive" : "secondary"}>
                    {anomalyResult.anomaly_count}
                  </Badge>
                </div>

                {/* Utilization (if capacity info available) */}
                {anomalyResult.input_utilization !== undefined && (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">↓ In Util:</span>
                      <span className={`font-medium ${
                        anomalyResult.input_utilization >= 95 ? "text-red-500" :
                        anomalyResult.input_utilization >= 80 ? "text-yellow-500" :
                        "text-green-500"
                      }`}>
                        {anomalyResult.input_utilization.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">↑ Out Util:</span>
                      <span className={`font-medium ${
                        (anomalyResult.output_utilization || 0) >= 95 ? "text-red-500" :
                        (anomalyResult.output_utilization || 0) >= 80 ? "text-yellow-500" :
                        "text-green-500"
                      }`}>
                        {anomalyResult.output_utilization?.toFixed(1) || 0}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Flatline Warning */}
                {anomalyResult.flatline_detected && (
                  <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                      <span className="font-medium text-orange-500">⚠️ Flatline Detected!</span>
                    </div>
                    
                    {/* Show which directions are flatlined */}
                    <div className="text-xs space-y-2 mb-2">
                      {/* Received/Download */}
                      <div className={`p-2 rounded ${anomalyResult.input_flatline ? "bg-red-500/20" : "bg-muted/50"}`}>
                        <div className="flex justify-between items-center">
                          <span className="flex items-center gap-1">
                            <span className="text-green-500">↓</span> Received (Download)
                          </span>
                          <span className={`font-medium ${anomalyResult.input_flatline ? "text-red-500" : ""}`}>
                            {anomalyResult.input_time_at_capacity_pct?.toFixed(1)}% at capacity
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          {anomalyResult.input_points_at_capacity} / {anomalyResult.total_points} points
                          {anomalyResult.input_flatline && <span className="text-red-500 ml-2">⚠️ FLATLINE</span>}
                        </div>
                      </div>
                      
                      {/* Sent/Upload */}
                      <div className={`p-2 rounded ${anomalyResult.output_flatline ? "bg-red-500/20" : "bg-muted/50"}`}>
                        <div className="flex justify-between items-center">
                          <span className="flex items-center gap-1">
                            <span className="text-blue-500">↑</span> Sent (Upload)
                          </span>
                          <span className={`font-medium ${anomalyResult.output_flatline ? "text-red-500" : ""}`}>
                            {anomalyResult.output_time_at_capacity_pct?.toFixed(1)}% at capacity
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          {anomalyResult.output_points_at_capacity} / {anomalyResult.total_points} points
                          {anomalyResult.output_flatline && <span className="text-red-500 ml-2">⚠️ FLATLINE</span>}
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-xs space-y-1 border-t pt-2">
                      {anomalyResult.flatline_threshold_formatted && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">95% threshold:</span>
                          <span className="font-medium">{anomalyResult.flatline_threshold_formatted}</span>
                        </div>
                      )}
                      {anomalyResult.capacity_threshold_formatted && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max capacity:</span>
                          <span className="font-medium">{anomalyResult.capacity_threshold_formatted}</span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs font-medium text-orange-500 mt-2">
                      Customer needs bandwidth upgrade!
                    </p>
                  </div>
                )}

                {/* Traffic Summary */}
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-2">Current Traffic</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-green-500">↓ In:</span>{" "}
                      {formatBytes(anomalyResult.summary.current_input)}
                    </div>
                    <div>
                      <span className="text-blue-500">↑ Out:</span>{" "}
                      {formatBytes(anomalyResult.summary.current_output)}
                    </div>
                  </div>
                </div>

                {/* Recent Anomalies */}
                {anomalyResult.anomalies.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-2">Recent Anomalies</p>
                    {anomalyResult.anomalies.slice(0, 3).map((a, i) => (
                      <div 
                        key={i} 
                        className={`text-xs p-2 rounded mb-1 ${
                          a.type === "flatline" 
                            ? "bg-orange-500/10 border border-orange-500/30" 
                            : "bg-red-500/10"
                        }`}
                      >
                        <span className={`font-medium ${a.type === "flatline" ? "text-orange-500" : ""}`}>
                          {a.type === "flatline" ? "⚠️ FLATLINE" : a.type}
                        </span>
                        : {a.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click refresh to analyze traffic</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* P95 Forecast Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                P95 Forecast
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={forecastP95}
                disabled={forecastLoading}
              >
                {forecastLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
            <CardDescription>
              Predict future bandwidth usage and upgrade needs
            </CardDescription>
          </CardHeader>
          <CardContent>
            {forecastError ? (
              <div className="text-red-500 text-sm">{forecastError}</div>
            ) : forecastResult ? (
              <div className="space-y-3">
                {/* Predicted P95 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Predicted P95</span>
                  <span className="font-bold">
                    {forecastResult.forecast.predicted_p95_formatted}
                  </span>
                </div>

                {/* Trend */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Trend</span>
                  <Badge
                    variant={
                      forecastResult.forecast.trend === "increasing"
                        ? "default"
                        : forecastResult.forecast.trend === "decreasing"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {forecastResult.forecast.trend} (
                    {forecastResult.forecast.growth_rate_percent.toFixed(1)}%/mo)
                  </Badge>
                </div>

                {/* Capacity */}
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-muted-foreground">Current Capacity</span>
                    <span>{forecastResult.capacity.current_formatted}</span>
                  </div>
                  {forecastResult.capacity.needs_upgrade && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Recommended</span>
                      <span className="text-green-500 font-medium">
                        {forecastResult.capacity.recommended_formatted}
                      </span>
                    </div>
                  )}
                </div>

                {/* Upgrade Alert */}
                {forecastResult.capacity.needs_upgrade && (
                  <div
                    className={`p-3 rounded-lg ${
                      forecastResult.capacity.urgency === "high"
                        ? "bg-red-500/10 border border-red-500/30"
                        : "bg-yellow-500/10 border border-yellow-500/30"
                    }`}
                  >
                    <p
                      className={`text-sm font-medium ${
                        forecastResult.capacity.urgency === "high"
                          ? "text-red-500"
                          : "text-yellow-500"
                      }`}
                    >
                      {forecastResult.capacity.urgency === "high"
                        ? "⚠️ Urgent Upgrade Recommended"
                        : "Upgrade Recommended"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {forecastResult.message}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click refresh to forecast P95</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CustomerMLAnalysis;

