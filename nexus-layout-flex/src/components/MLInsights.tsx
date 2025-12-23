import React, { useState, useEffect } from "react";
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
  Zap,
  RefreshCw,
  Brain,
  ArrowUpRight,
  AlertCircle,
} from "lucide-react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";

interface AnomalySummary {
  total_analyzed: number;
  anomalies_detected: number;
  critical_count: number;
  warning_count: number;
}

interface ForecastSummary {
  total_forecasted: number;
  upgrades_recommended: number;
  high_urgency: number;
  medium_urgency: number;
}

interface UpgradeRecommendation {
  customer_name: string;
  customer_id: string;
  utilization: number;
  urgency: string;
}

interface MLInsightsData {
  status?: string;
  timestamp: string;
  anomaly_summary: AnomalySummary;
  forecast_summary: ForecastSummary;
  recent_anomalies: any[];
  upgrade_recommendations: UpgradeRecommendation[];
}

const MLInsights: React.FC = () => {
  const [insights, setInsights] = useState<MLInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${PRODUCTION_URL}/ml/dashboard/insights`);
      setInsights(response.data);
    } catch (err: any) {
      setError(err.message || "Failed to fetch ML insights");
      // Set default empty data
      setInsights({
        status: "unavailable",
        timestamp: new Date().toISOString(),
        anomaly_summary: {
          total_analyzed: 0,
          anomalies_detected: 0,
          critical_count: 0,
          warning_count: 0,
        },
        forecast_summary: {
          total_forecasted: 0,
          upgrades_recommended: 0,
          high_urgency: 0,
          medium_urgency: 0,
        },
        recent_anomalies: [],
        upgrade_recommendations: [],
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
    // Refresh every 5 minutes
    const interval = setInterval(fetchInsights, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const isMLServiceAvailable = insights?.status !== "ml_service_unavailable" && insights?.status !== "unavailable";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-500" />
          <h3 className="text-lg font-semibold">AI Insights</h3>
          {!isMLServiceAvailable && (
            <Badge variant="outline" className="text-yellow-500 border-yellow-500">
              ML Service Offline
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchInsights}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Anomalies Detected */}
        <Card className="dashboard-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Anomalies Detected</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {insights?.anomaly_summary.anomalies_detected || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {insights?.anomaly_summary.critical_count || 0} critical,{" "}
              {insights?.anomaly_summary.warning_count || 0} warnings
            </p>
          </CardContent>
        </Card>

        {/* Traffic Analyzed */}
        <Card className="dashboard-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Traffic Analyzed</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {insights?.anomaly_summary.total_analyzed || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Data points processed
            </p>
          </CardContent>
        </Card>

        {/* Upgrades Recommended */}
        <Card className="dashboard-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Upgrades Needed</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {insights?.forecast_summary.upgrades_recommended || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {insights?.forecast_summary.high_urgency || 0} urgent
            </p>
          </CardContent>
        </Card>

        {/* High Utilization */}
        <Card className="dashboard-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Utilization</CardTitle>
            <Zap className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {insights?.forecast_summary.high_urgency || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Customers over 90% capacity
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Upgrade Recommendations */}
      {insights?.upgrade_recommendations && insights.upgrade_recommendations.length > 0 && (
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-green-500" />
              Upgrade Recommendations
            </CardTitle>
            <CardDescription>
              Customers predicted to need capacity upgrades
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.upgrade_recommendations.slice(0, 5).map((rec, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div>
                    <p className="font-medium">{rec.customer_name}</p>
                    <p className="text-sm text-muted-foreground">
                      Utilization: {rec.utilization.toFixed(1)}%
                    </p>
                  </div>
                  <Badge
                    variant={rec.urgency === "high" ? "destructive" : "secondary"}
                  >
                    {rec.urgency === "high" ? "Urgent" : "Recommended"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ML Service Status */}
      {!isMLServiceAvailable && (
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="font-medium text-yellow-500">ML Service Not Running</p>
              <p className="text-sm text-muted-foreground">
                Start the ML service to enable AI-powered insights:{" "}
                <code className="bg-muted px-1 rounded">cd ml-service && python main.py</code>
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MLInsights;

