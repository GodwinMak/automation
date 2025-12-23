"""
Traffic Forecasting Module

Provides 95th percentile forecasting and bandwidth prediction using:
1. Exponential Smoothing - for trend-based forecasting
2. Linear Regression - for simple growth prediction
3. Historical Pattern Analysis - for seasonal patterns
"""

import numpy as np
from scipy import stats
from sklearn.linear_model import LinearRegression
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class ForecastResult:
    """Result of traffic forecasting"""
    predicted_p95: float
    confidence_interval: Tuple[float, float]
    trend: str  # 'increasing', 'decreasing', 'stable'
    growth_rate: float  # percentage per month
    needs_upgrade: bool
    upgrade_urgency: str  # 'none', 'low', 'medium', 'high'
    forecast_days: int
    message: str
    details: Dict


class TrafficForecaster:
    """
    Forecasts network traffic and 95th percentile usage.
    """
    
    def __init__(
        self,
        forecast_days: int = 30,
        confidence_level: float = 0.95
    ):
        """
        Initialize the forecaster.
        
        Args:
            forecast_days: Number of days to forecast ahead
            confidence_level: Confidence level for intervals (0-1)
        """
        self.forecast_days = forecast_days
        self.confidence_level = confidence_level
    
    def calculate_p95(self, values: List[float]) -> float:
        """
        Calculate 95th percentile using Zabbix method.
        
        Args:
            values: List of traffic values
            
        Returns:
            95th percentile value
        """
        if not values:
            return 0.0
        
        sorted_values = sorted(values)
        n = len(sorted_values)
        position = n * 0.95
        
        if position % 1 != 0:
            # Not whole - round up
            index = int(np.ceil(position)) - 1
            return sorted_values[min(index, n - 1)]
        else:
            # Whole number - average of position and position+1
            index1 = int(position) - 1
            index2 = int(position)
            if index2 >= n:
                return sorted_values[index1]
            return (sorted_values[index1] + sorted_values[index2]) / 2
    
    def forecast_p95(
        self,
        historical_p95: List[Dict],
        capacity: float
    ) -> ForecastResult:
        """
        Forecast future 95th percentile based on historical data.
        
        Args:
            historical_p95: List of dicts with 'month', 'p95' keys
                           e.g., [{'month': '2024-01', 'p95': 50000000}, ...]
            capacity: Customer's current capacity in bps
            
        Returns:
            ForecastResult with predictions
        """
        if len(historical_p95) < 2:
            return ForecastResult(
                predicted_p95=0,
                confidence_interval=(0, 0),
                trend="unknown",
                growth_rate=0,
                needs_upgrade=False,
                upgrade_urgency="none",
                forecast_days=self.forecast_days,
                message="Insufficient historical data for forecasting",
                details={"reason": "need_more_data", "data_points": len(historical_p95)}
            )
        
        # Extract P95 values and create time indices
        p95_values = [d['p95'] for d in historical_p95]
        months = list(range(len(p95_values)))
        
        # Calculate trend using multiple methods
        linear_forecast = self._linear_forecast(months, p95_values)
        exp_forecast = self._exponential_smoothing_forecast(p95_values)
        
        # Combine forecasts (weighted average)
        predicted_p95 = 0.6 * linear_forecast['prediction'] + 0.4 * exp_forecast['prediction']
        
        # Calculate confidence interval
        std_error = np.std(p95_values) * 1.5  # Expand for forecast uncertainty
        z_score = stats.norm.ppf((1 + self.confidence_level) / 2)
        margin = z_score * std_error
        confidence_interval = (
            max(0, predicted_p95 - margin),
            predicted_p95 + margin
        )
        
        # Determine trend
        growth_rate = linear_forecast['slope'] / np.mean(p95_values) * 100 if np.mean(p95_values) > 0 else 0
        
        if growth_rate > 5:
            trend = "increasing"
        elif growth_rate < -5:
            trend = "decreasing"
        else:
            trend = "stable"
        
        # Check if upgrade is needed
        utilization = (predicted_p95 / capacity * 100) if capacity > 0 else 0
        utilization_upper = (confidence_interval[1] / capacity * 100) if capacity > 0 else 0
        
        if utilization_upper > 90:
            needs_upgrade = True
            upgrade_urgency = "high"
        elif utilization_upper > 80:
            needs_upgrade = True
            upgrade_urgency = "medium"
        elif utilization_upper > 70:
            needs_upgrade = True
            upgrade_urgency = "low"
        else:
            needs_upgrade = False
            upgrade_urgency = "none"
        
        # Generate message
        if needs_upgrade:
            message = f"Upgrade recommended: Predicted usage {self._format_bytes(predicted_p95)} ({utilization:.1f}% of capacity)"
            if upgrade_urgency == "high":
                message = f"⚠️ URGENT: {message}"
        else:
            message = f"Capacity sufficient: Predicted usage {self._format_bytes(predicted_p95)} ({utilization:.1f}% of capacity)"
        
        return ForecastResult(
            predicted_p95=predicted_p95,
            confidence_interval=confidence_interval,
            trend=trend,
            growth_rate=growth_rate,
            needs_upgrade=needs_upgrade,
            upgrade_urgency=upgrade_urgency,
            forecast_days=self.forecast_days,
            message=message,
            details={
                "historical_months": len(historical_p95),
                "current_p95": p95_values[-1] if p95_values else 0,
                "utilization_percent": utilization,
                "utilization_upper_bound": utilization_upper,
                "capacity": capacity,
                "capacity_formatted": self._format_bytes(capacity),
                "linear_forecast": linear_forecast,
                "exp_forecast": exp_forecast,
                "historical_trend": p95_values[-3:] if len(p95_values) >= 3 else p95_values
            }
        )
    
    def _linear_forecast(
        self,
        time_indices: List[int],
        values: List[float]
    ) -> Dict:
        """Linear regression based forecast"""
        X = np.array(time_indices).reshape(-1, 1)
        y = np.array(values)
        
        model = LinearRegression()
        model.fit(X, y)
        
        # Predict for next month
        next_index = len(time_indices)
        prediction = model.predict([[next_index]])[0]
        
        # Calculate R² score
        r_squared = model.score(X, y)
        
        return {
            "prediction": max(0, prediction),
            "slope": model.coef_[0],
            "intercept": model.intercept_,
            "r_squared": r_squared
        }
    
    def _exponential_smoothing_forecast(
        self,
        values: List[float],
        alpha: float = 0.3
    ) -> Dict:
        """Simple exponential smoothing forecast"""
        if len(values) < 2:
            return {"prediction": values[-1] if values else 0, "smoothed": values}
        
        smoothed = [values[0]]
        for i in range(1, len(values)):
            smoothed.append(alpha * values[i] + (1 - alpha) * smoothed[-1])
        
        # Forecast: continue the trend
        trend = smoothed[-1] - smoothed[-2] if len(smoothed) >= 2 else 0
        prediction = smoothed[-1] + trend
        
        return {
            "prediction": max(0, prediction),
            "smoothed": smoothed,
            "trend": trend
        }
    
    @staticmethod
    def _format_bytes(value: float) -> str:
        """Format bytes to human readable"""
        if value >= 1e9:
            return f"{value/1e9:.2f} Gbps"
        elif value >= 1e6:
            return f"{value/1e6:.2f} Mbps"
        elif value >= 1e3:
            return f"{value/1e3:.2f} Kbps"
        return f"{value:.2f} bps"


class CapacityPlanner:
    """
    Provides capacity planning recommendations based on traffic patterns.
    """
    
    def __init__(self):
        self.forecaster = TrafficForecaster()
    
    def recommend_capacity(
        self,
        current_capacity: float,
        historical_p95: List[Dict],
        growth_buffer: float = 0.3
    ) -> Dict:
        """
        Recommend new capacity based on forecasted usage.
        
        Args:
            current_capacity: Current capacity in bps
            historical_p95: Historical P95 data
            growth_buffer: Extra buffer percentage (0.3 = 30%)
            
        Returns:
            Capacity recommendation
        """
        forecast = self.forecaster.forecast_p95(historical_p95, current_capacity)
        
        if not forecast.needs_upgrade:
            return {
                "current_capacity": current_capacity,
                "current_capacity_formatted": self._format_bytes(current_capacity),
                "recommended_capacity": current_capacity,
                "recommended_capacity_formatted": self._format_bytes(current_capacity),
                "action": "maintain",
                "message": "Current capacity is sufficient",
                "forecast": forecast
            }
        
        # Calculate recommended capacity
        # Use upper confidence bound + growth buffer
        predicted_usage = forecast.confidence_interval[1]
        recommended = predicted_usage * (1 + growth_buffer)
        
        # Round up to nearest standard capacity tier
        capacity_tiers = [
            1e6,    # 1 Mbps
            2e6,    # 2 Mbps
            5e6,    # 5 Mbps
            10e6,   # 10 Mbps
            20e6,   # 20 Mbps
            50e6,   # 50 Mbps
            100e6,  # 100 Mbps
            200e6,  # 200 Mbps
            500e6,  # 500 Mbps
            1e9,    # 1 Gbps
            2e9,    # 2 Gbps
            5e9,    # 5 Gbps
            10e9,   # 10 Gbps
        ]
        
        recommended_tier = current_capacity
        for tier in capacity_tiers:
            if tier > recommended:
                recommended_tier = tier
                break
        
        return {
            "current_capacity": current_capacity,
            "current_capacity_formatted": self._format_bytes(current_capacity),
            "recommended_capacity": recommended_tier,
            "recommended_capacity_formatted": self._format_bytes(recommended_tier),
            "upgrade_factor": recommended_tier / current_capacity if current_capacity > 0 else 0,
            "action": "upgrade",
            "urgency": forecast.upgrade_urgency,
            "message": f"Upgrade recommended: {self._format_bytes(current_capacity)} → {self._format_bytes(recommended_tier)}",
            "forecast": forecast
        }
    
    @staticmethod
    def _format_bytes(value: float) -> str:
        """Format bytes to human readable"""
        if value >= 1e9:
            return f"{value/1e9:.2f} Gbps"
        elif value >= 1e6:
            return f"{value/1e6:.2f} Mbps"
        elif value >= 1e3:
            return f"{value/1e3:.2f} Kbps"
        return f"{value:.2f} bps"


def forecast_customer_p95(
    customer_id: str,
    historical_data: List[Dict],
    capacity: float
) -> Dict:
    """
    Convenience function to forecast P95 for a customer.
    
    Args:
        customer_id: Customer identifier
        historical_data: List of monthly P95 data
        capacity: Current capacity in bps
        
    Returns:
        Forecast results including recommendations
    """
    planner = CapacityPlanner()
    recommendation = planner.recommend_capacity(capacity, historical_data)
    
    return {
        "customer_id": customer_id,
        "forecast": {
            "predicted_p95": recommendation["forecast"].predicted_p95,
            "predicted_p95_formatted": planner._format_bytes(recommendation["forecast"].predicted_p95),
            "confidence_low": recommendation["forecast"].confidence_interval[0],
            "confidence_high": recommendation["forecast"].confidence_interval[1],
            "trend": recommendation["forecast"].trend,
            "growth_rate_percent": recommendation["forecast"].growth_rate
        },
        "capacity": {
            "current": recommendation["current_capacity"],
            "current_formatted": recommendation["current_capacity_formatted"],
            "recommended": recommendation["recommended_capacity"],
            "recommended_formatted": recommendation["recommended_capacity_formatted"],
            "needs_upgrade": recommendation["forecast"].needs_upgrade,
            "urgency": recommendation.get("urgency", "none")
        },
        "message": recommendation["message"],
        "details": recommendation["forecast"].details
    }

