const express = require("express");
const router = express.Router();
const axios = require("axios");

// ML Service URL (default to localhost:5000)
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5000";

/**
 * Proxy to ML service health check
 */
router.get("/health", async (req, res) => {
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/health`);
    res.json(response.data);
  } catch (error) {
    res.status(503).json({
      status: "unavailable",
      message: "ML service is not running",
      error: error.message,
    });
  }
});

/**
 * Analyze traffic anomalies
 * POST /ml/analyze/anomalies
 */
router.post("/analyze/anomalies", async (req, res) => {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/analyze/anomalies`,
      req.body
    );
    res.json(response.data);
  } catch (error) {
    console.error("ML anomaly analysis error:", error.message);
    res.status(500).json({
      error: "Failed to analyze anomalies",
      message: error.response?.data?.detail || error.message,
    });
  }
});

/**
 * Forecast P95
 * POST /ml/forecast/p95
 */
router.post("/forecast/p95", async (req, res) => {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/forecast/p95`,
      req.body
    );
    res.json(response.data);
  } catch (error) {
    console.error("ML forecast error:", error.message);
    res.status(500).json({
      error: "Failed to forecast P95",
      message: error.response?.data?.detail || error.message,
    });
  }
});

/**
 * Analyze traffic from Zabbix directly
 * POST /ml/analyze/zabbix
 */
router.post("/analyze/zabbix", async (req, res) => {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/analyze/zabbix`,
      req.body
    );
    res.json(response.data);
  } catch (error) {
    console.error("ML Zabbix analysis error:", error.message);
    res.status(500).json({
      error: "Failed to analyze Zabbix data",
      message: error.response?.data?.detail || error.message,
    });
  }
});

/**
 * Analyze customer traffic
 * GET /ml/analyze/customer/:customerId
 */
router.get("/analyze/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { customerType = "DIA", hours = 24, upCapacity, downCapacity } = req.query;
    console.log("customerId", customerId);

    const response = await axios.get(
      `${ML_SERVICE_URL}/analyze/customer/${customerId}`,
      {
        params: { 
          customer_type: customerType, 
          hours,
          up_capacity: upCapacity,
          down_capacity: downCapacity
        },
      }
    );
    console.log("response", response.data);
    res.json(response.data);
  } catch (error) {
    console.log("error", error);
    console.error("ML customer analysis error:", error.message);
    res.status(500).json({
      error: "Failed to analyze customer traffic",
      message: error.response?.data?.detail || error.message,
    });
  }
});

/**
 * Forecast customer P95
 * GET /ml/forecast/customer/:customerId
 */
router.get("/forecast/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { customerType = "DIA" } = req.query;

    const response = await axios.get(
      `${ML_SERVICE_URL}/forecast/customer/${customerId}`,
      {
        params: { customer_type: customerType },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error("ML customer forecast error:", error.message);
    res.status(500).json({
      error: "Failed to forecast customer P95",
      message: error.response?.data?.detail || error.message,
    });
  }
});

/**
 * Get dashboard insights
 * GET /ml/dashboard/insights
 */
router.get("/dashboard/insights", async (req, res) => {
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/dashboard/insights`);
    res.json(response.data);
  } catch (error) {
    console.error("ML dashboard insights error:", error.message);
    // Return empty insights if ML service is unavailable
    res.json({
      status: "ml_service_unavailable",
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
  }
});

module.exports = router;

