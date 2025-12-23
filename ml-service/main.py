"""
ML Service for Network Traffic Analysis

Provides REST API endpoints for:
- Traffic anomaly detection
- 95th percentile forecasting
- Capacity planning recommendations
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
import httpx
from datetime import datetime

from models import (
    analyze_traffic_anomalies,
    forecast_customer_p95,
    TrafficAnomalyDetector,
    TrafficForecaster,
    CapacityPlanner
)
from config import ZABBIX_API_URL, ZABBIX_USERNAME, ZABBIX_PASSWORD, BACKEND_URL

import numpy as np

def to_python_types(obj):
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.int64):
        return int(obj)
    if isinstance(obj, np.float64):
        return float(obj)
    if isinstance(obj, dict):
        return {k: to_python_types(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_python_types(v) for v in obj]
    return obj


def format_bytes(value: float) -> str:
    """Format bytes to human readable"""
    if value >= 1e9:
        return f"{value/1e9:.2f} Gbps"
    elif value >= 1e6:
        return f"{value/1e6:.2f} Mbps"
    elif value >= 1e3:
        return f"{value/1e3:.2f} Kbps"
    return f"{value:.2f} bps"


def detect_flatline_at_capacity(
    result: Dict, 
    capacity: float, 
    traffic_data: List[Dict] = None,
    flatline_threshold: float = 0.95, 
    time_threshold: float = 0.60
) -> Dict:
    """
    Detect if traffic is flat-lining at or near max capacity.
    
    Checks BOTH sent (output) and received (input) separately:
    - If input (download/received) is at 95%+ capacity for 60%+ of the time → flatline
    - If output (upload/sent) is at 95%+ capacity for 60%+ of the time → flatline
    
    Args:
        result: Original anomaly detection result
        capacity: Customer's configured capacity in bps (same for up/down)
        traffic_data: List of traffic data points with 'input' and 'output' values
        flatline_threshold: Percentage of capacity to consider as "at max" (0.95 = 95%)
        time_threshold: Percentage of time that must be at max to flag (0.60 = 60%)
    
    Returns:
        Updated result with flatline detection
    """
    if capacity <= 0:
        result["flatline_detected"] = False
        return result
    
    # Calculate the threshold value (95% of capacity)
    threshold_value = capacity * flatline_threshold
    
    summary = result.get("summary", {})
    avg_input = summary.get("avg_input", 0)
    avg_output = summary.get("avg_output", 0)
    max_input = summary.get("max_input", 0)
    max_output = summary.get("max_output", 0)
    
    # Calculate utilization for display
    input_utilization = (avg_input / capacity) * 100 if capacity > 0 else 0
    output_utilization = (avg_output / capacity) * 100 if capacity > 0 else 0
    avg_utilization = max(input_utilization, output_utilization)
    max_utilization = (max(max_input, max_output) / capacity) * 100 if capacity > 0 else 0
    
    # Count data points at or above 95% capacity - CHECK BOTH SEPARATELY
    input_points_at_capacity = 0
    output_points_at_capacity = 0
    total_points = 0
    
    if traffic_data and len(traffic_data) > 0:
        total_points = len(traffic_data)
        for point in traffic_data:
            input_val = point.get("input", 0)
            output_val = point.get("output", 0)
            
            # Check input (received/download) separately
            if input_val >= threshold_value:
                input_points_at_capacity += 1
            
            # Check output (sent/upload) separately
            if output_val >= threshold_value:
                output_points_at_capacity += 1
    
    # Calculate percentage of time at capacity for each direction
    input_time_pct = (input_points_at_capacity / total_points * 100) if total_points > 0 else 0
    output_time_pct = (output_points_at_capacity / total_points * 100) if total_points > 0 else 0
    
    # Detect flatline: 60%+ of time at 95%+ capacity for EITHER direction
    input_flatline = total_points > 0 and (input_points_at_capacity / total_points) >= time_threshold
    output_flatline = total_points > 0 and (output_points_at_capacity / total_points) >= time_threshold
    is_flatline = input_flatline or output_flatline
    
    # Determine which direction is flatlined
    flatline_directions = []
    if input_flatline:
        flatline_directions.append(f"Received/Download ({input_time_pct:.1f}%)")
    if output_flatline:
        flatline_directions.append(f"Sent/Upload ({output_time_pct:.1f}%)")
    
    if is_flatline:
        direction_str = " and ".join(flatline_directions)
        flatline_message = (
            f"⚠️ FLATLINE AT CAPACITY: {direction_str} traffic is at 95%+ of capacity "
            f"({format_bytes(threshold_value)}) for 60%+ of the time. Customer needs upgrade!"
        )
        
        result["flatline_detected"] = True
        result["flatline_message"] = flatline_message
        result["flatline_directions"] = flatline_directions
        result["input_flatline"] = input_flatline
        result["output_flatline"] = output_flatline
        result["input_time_at_capacity_pct"] = input_time_pct
        result["output_time_at_capacity_pct"] = output_time_pct
        result["time_at_capacity_pct"] = max(input_time_pct, output_time_pct)
        result["input_points_at_capacity"] = input_points_at_capacity
        result["output_points_at_capacity"] = output_points_at_capacity
        result["points_at_capacity"] = max(input_points_at_capacity, output_points_at_capacity)
        result["total_points"] = total_points
        result["flatline_threshold_value"] = threshold_value
        result["flatline_threshold_formatted"] = format_bytes(threshold_value)
        
        # Add flatline as an anomaly
        flatline_anomaly = {
            "type": "flatline",
            "confidence": min(max(input_time_pct, output_time_pct) / 100, 1.0),
            "message": flatline_message,
            "input": avg_input,
            "output": avg_output,
            "details": {
                "input_time_at_capacity_pct": input_time_pct,
                "output_time_at_capacity_pct": output_time_pct,
                "input_points_at_capacity": input_points_at_capacity,
                "output_points_at_capacity": output_points_at_capacity,
                "total_points": total_points,
                "threshold_value": threshold_value,
                "threshold_formatted": format_bytes(threshold_value),
                "capacity": capacity,
                "capacity_formatted": format_bytes(capacity),
                "input_flatline": input_flatline,
                "output_flatline": output_flatline
            }
        }
        
        if "anomalies" not in result:
            result["anomalies"] = []
        result["anomalies"].insert(0, flatline_anomaly)  # Add at beginning (high priority)
        result["anomaly_count"] = len(result["anomalies"])
        
        # Update health status for flatline
        max_time_pct = max(input_time_pct, output_time_pct)
        if max_time_pct >= 80:
            result["health_score"] = min(result.get("health_score", 100), 30)
            result["health_status"] = "critical"
        elif max_time_pct >= 60:
            result["health_score"] = min(result.get("health_score", 100), 50)
            result["health_status"] = "warning"
    else:
        result["flatline_detected"] = False
        result["input_flatline"] = False
        result["output_flatline"] = False
        result["input_time_at_capacity_pct"] = input_time_pct
        result["output_time_at_capacity_pct"] = output_time_pct
        result["time_at_capacity_pct"] = max(input_time_pct, output_time_pct)
        result["input_points_at_capacity"] = input_points_at_capacity
        result["output_points_at_capacity"] = output_points_at_capacity
        result["points_at_capacity"] = max(input_points_at_capacity, output_points_at_capacity)
        result["total_points"] = total_points
    
    result["avg_utilization"] = avg_utilization
    result["max_utilization"] = max_utilization
    result["input_utilization"] = input_utilization
    result["output_utilization"] = output_utilization
    
    return result


def filter_anomalies_by_capacity(result: Dict, up_capacity: Optional[float], down_capacity: Optional[float]) -> Dict:
    """
    Filter anomalies based on customer's configured capacity.
    
    Only flag as anomaly if traffic exceeds the capacity threshold.
    This prevents false positives where normal usage is flagged as "spike"
    just because it's higher than recent average.
    
    Args:
        result: Original anomaly detection result
        up_capacity: Upload capacity threshold in bps (already includes 10% buffer)
        down_capacity: Download capacity threshold in bps (already includes 10% buffer)
    
    Returns:
        Filtered result with capacity-aware anomalies
    """
    # Use the higher capacity as the threshold (customers often have symmetric or use max)
    capacity_threshold = max(up_capacity or 0, down_capacity or 0)
    
    if capacity_threshold == 0:
        return result  # No capacity info, return original result
    
    # Original capacity (without the 10% buffer) for flatline detection
    original_capacity = capacity_threshold / 1.1
    
    filtered_anomalies = []
    
    for anomaly in result.get("anomalies", []):
        # Get the traffic values that triggered the anomaly
        input_val = anomaly.get("input", 0)
        output_val = anomaly.get("output", 0)
        max_traffic = max(input_val, output_val)
        combined_traffic = input_val + output_val
        
        # Only keep anomaly if it actually exceeds capacity
        if anomaly.get("type") == "spike":
            # For spikes, only flag if traffic exceeds capacity threshold
            if max_traffic > capacity_threshold or combined_traffic > capacity_threshold:
                # Update message to reflect capacity comparison
                utilization = (max_traffic / capacity_threshold) * 100
                anomaly["message"] = f"Traffic exceeds capacity: {format_bytes(max_traffic)} ({utilization:.1f}% of limit)"
                filtered_anomalies.append(anomaly)
            # else: Skip this anomaly - it's within capacity limits
        elif anomaly.get("type") == "drop":
            # Keep drop anomalies as they indicate potential issues
            filtered_anomalies.append(anomaly)
        else:
            # For unusual patterns, check if it's significant relative to capacity
            if max_traffic > capacity_threshold * 0.8:  # 80% of capacity
                filtered_anomalies.append(anomaly)
    
    # Recalculate health score based on filtered anomalies
    filtered_count = len(filtered_anomalies)
    if filtered_count == 0:
        health_score = 100
        health_status = "healthy"
    elif filtered_count <= 2:
        health_score = 80
        health_status = "healthy"
    elif filtered_count <= 5:
        health_score = 60
        health_status = "warning"
    else:
        health_score = max(0, 100 - (filtered_count * 10))
        health_status = "critical" if health_score < 50 else "warning"
    
    result["anomalies"] = filtered_anomalies
    result["anomaly_count"] = filtered_count
    result["health_score"] = health_score
    result["health_status"] = health_status
    result["capacity_threshold"] = capacity_threshold
    result["capacity_threshold_formatted"] = format_bytes(capacity_threshold)
    
    # Get traffic data from result (stored by analyze_from_zabbix)
    traffic_data = result.pop("_traffic_data", None)
    
    # Now detect flatline at capacity (use original capacity without buffer)
    # Pass traffic_data for accurate 60%+ time at 95% capacity detection
    result = detect_flatline_at_capacity(result, original_capacity, traffic_data)
    
    return result

app = FastAPI(
    title="Network Traffic ML Service",
    description="Machine Learning service for traffic anomaly detection and forecasting",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Zabbix auth token
zabbix_auth_token: Optional[str] = None


# ==================== Pydantic Models ====================

class TrafficDataPoint(BaseModel):
    timestamp: Optional[str] = None
    input: float
    output: float


class AnomalyRequest(BaseModel):
    traffic_data: List[TrafficDataPoint]


class ForecastRequest(BaseModel):
    historical_p95: List[Dict]  # [{'month': '2024-01', 'p95': 50000000}, ...]
    capacity: float  # Current capacity in bps


class ZabbixFetchRequest(BaseModel):
    switch_name: str
    interface_name: str
    hours: int = 24


class CustomerForecastRequest(BaseModel):
    customer_id: str
    customer_type: str  # 'DIA', 'IPT', 'Shared'


# ==================== Zabbix Helper Functions ====================

async def get_zabbix_auth() -> str:
    """Get or refresh Zabbix auth token"""
    global zabbix_auth_token
    
    if zabbix_auth_token:
        return zabbix_auth_token
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            ZABBIX_API_URL,
            json={
                "jsonrpc": "2.0",
                "method": "user.login",
                "params": {
                    "username": ZABBIX_USERNAME,
                    "password": ZABBIX_PASSWORD
                },
                "id": 1
            },
            headers={"Content-Type": "application/json"}
        )
        
        data = response.json()
        if "result" in data:
            zabbix_auth_token = data["result"]
            return zabbix_auth_token
        else:
            raise HTTPException(status_code=500, detail="Failed to authenticate with Zabbix")


async def zabbix_api_call(method: str, params: dict) -> dict:
    print("method", method)
    print("params", params)
    """Make a Zabbix API call"""
    auth = await get_zabbix_auth()
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            ZABBIX_API_URL,
            json={
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
                "auth": auth,
                "id": 1
            },
            headers={"Content-Type": "application/json"}
        )
        
        data = response.json()
        if "error" in data:
            raise HTTPException(status_code=500, detail=f"Zabbix API error: {data['error']}")
        
        return data.get("result", [])


# ==================== API Endpoints ====================

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Network Traffic ML Service",
        "version": "1.0.0",
        "endpoints": [
            "/analyze/anomalies",
            "/forecast/p95",
            "/analyze/customer/{customer_id}",
            "/forecast/customer/{customer_id}"
        ]
    }


@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "zabbix_connected": zabbix_auth_token is not None
    }


@app.post("/analyze/anomalies")
async def analyze_anomalies(request: AnomalyRequest):
    """
    Analyze traffic data for anomalies.
    
    Expects a list of traffic data points with input/output values.
    Returns anomaly detection results.
    """
    try:
        traffic_data = [
            {
                "timestamp": point.timestamp,
                "input": point.input,
                "output": point.output
            }
            for point in request.traffic_data
        ]
        
        result = analyze_traffic_anomalies(traffic_data)
        return result
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/forecast/p95")
async def forecast_p95(request: ForecastRequest):
    """
    Forecast 95th percentile based on historical data.
    
    Expects historical P95 data and current capacity.
    Returns forecast with upgrade recommendations.
    """
    try:
        result = forecast_customer_p95(
            customer_id="manual",
            historical_data=request.historical_p95,
            capacity=request.capacity
        )
        return result
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze/zabbix")
async def analyze_from_zabbix(request: ZabbixFetchRequest):
    """
    Fetch traffic data from Zabbix and analyze for anomalies.
    """
    try:
        # Map switch name to Zabbix host
        host_mapping = {
            "LTZ-PE1-RAH": "lo-0.ltz-pe1-rah.liquidtelecom.net",
            "LTZ-P1-DAR": "lo-0.ltz-p1-dar.liquidtelecom.net",
        }
        zabbix_host = host_mapping.get(request.switch_name, request.switch_name)
        
        # Get host ID
        hosts = await zabbix_api_call("host.get", {
            "output": ["hostid"],
            "filter": {"host": [zabbix_host]}
        })
        print("hosts", hosts)
        if not hosts:
            raise HTTPException(status_code=404, detail=f"Host not found: {zabbix_host}")
        
        host_id = hosts[0]["hostid"]
        
        # Get graph items for the interface
        graphs = await zabbix_api_call("graph.get", {
            "hostids": [host_id],
            "search": {"name": request.interface_name},
            "output": "extend",
            "selectItems": "extend"
        })
        
        if not graphs:
            raise HTTPException(status_code=404, detail=f"Graph not found for interface: {request.interface_name}")
        
        item_ids = [item["itemid"] for item in graphs[0]["items"]]
        
        # Get history
        now = int(datetime.now().timestamp())
        time_from = now - (request.hours * 3600)
        
        history = await zabbix_api_call("history.get", {
            "history": 3,
            "itemids": item_ids,
            "time_from": time_from,
            "time_till": now,
            "output": "extend",
            "sortfield": "clock"
        })
        
        # Process history into traffic data
        grouped = {}
        for h in history:
            clock = int(h["clock"])
            if clock not in grouped:
                grouped[clock] = {"input": 0, "output": 0}
            
            item = next((i for i in graphs[0]["items"] if i["itemid"] == h["itemid"]), None)
            if item:
                value = float(h["value"])
                if "in" in item["name"].lower():
                    grouped[clock]["input"] = value
                else:
                    grouped[clock]["output"] = value
        
        # Convert to list
        traffic_data = [
            {
                "timestamp": datetime.fromtimestamp(ts).isoformat(),
                "input": data["input"],
                "output": data["output"]
            }
            for ts, data in sorted(grouped.items())
        ]
        
        # Analyze
        result = analyze_traffic_anomalies(traffic_data)
        result["switch_name"] = request.switch_name
        result["interface_name"] = request.interface_name
        result["hours_analyzed"] = request.hours
        
        # Store traffic_data in result for flatline detection
        result["_traffic_data"] = traffic_data
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/analyze/customer/{customer_id}")
async def analyze_customer(
    customer_id: str, 
    customer_type: str = "DIA", 
    hours: int = 24,
    up_capacity: Optional[float] = None,
    down_capacity: Optional[float] = None
):
    """
    Analyze a customer's traffic from the backend database.
    
    Args:
        customer_id: Customer ID
        customer_type: DIA, IPT, or Shared
        hours: Hours of history to analyze
        up_capacity: Customer's upload capacity in bps (with 10% buffer already applied)
        down_capacity: Customer's download capacity in bps (with 10% buffer already applied)
    """
    try:
        # Fetch customer from backend
        async with httpx.AsyncClient() as client:
            if customer_type == "DIA":
                response = await client.get(f"{BACKEND_URL}/customers/{customer_id}")
            elif customer_type == "IPT":
                response = await client.get(f"{BACKEND_URL}/iptcustomers/{customer_id}")
            else:
                response = await client.get(f"{BACKEND_URL}/sharedcustomers/{customer_id}")
            
            if response.status_code != 200:
                raise HTTPException(status_code=404, detail="Customer not found")
            
            customer = response.json()
        
        # Get switch name and interface
        if customer_type == "DIA":
            switch_name = customer.get("diacustomer", {}).get("switchName")
            interface_name = customer.get("interface")
        elif customer_type == "IPT":
            switch_name = customer.get("iptcustomer", {}).get("switchName")
            interface_name = customer.get("interface")
        else:
            switch_name = customer.get("sharedcustomer", {}).get("switchName")
            interface_name = customer.get("interface")
        
        if not switch_name or not interface_name:
            return {
                "customer_id": customer_id,
                "customer_name": customer.get("customerName"),
                "status": "incomplete_data",
                "message": "Missing switch name or interface"
            }
        
        # Analyze using Zabbix
        zabbix_request = ZabbixFetchRequest(
            switch_name=switch_name,
            interface_name=interface_name,
            hours=hours
        )
        
        result = await analyze_from_zabbix(zabbix_request)
        print("result", result)
        result["customer_id"] = customer_id
        result["customer_name"] = customer.get("customerName")
        result["customer_type"] = customer_type
        
        # Apply capacity-aware filtering to anomalies
        if up_capacity or down_capacity:
            result = filter_anomalies_by_capacity(result, up_capacity, down_capacity)
        
        # return result
        return to_python_types(result)
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/forecast/customer/{customer_id}")
async def forecast_customer(customer_id: str, customer_type: str = "DIA"):
    """
    Forecast P95 for a customer based on historical reports.
    """
    try:
        # Fetch historical P95 reports from backend
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{BACKEND_URL}/percentile-reports",
                params={"reportType": customer_type}
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=500, detail="Failed to fetch reports")
            
            data = response.json()
            reports = data.get("reports", [])
        
        # Filter for this customer
        customer_reports = [r for r in reports if r.get("customerId") == customer_id]
        
        if len(customer_reports) < 2:
            return {
                "customer_id": customer_id,
                "status": "insufficient_data",
                "message": f"Need at least 2 months of P95 data. Found: {len(customer_reports)}"
            }
        
        # Format for forecaster
        historical_p95 = [
            {
                "month": r["month"],
                "p95": r.get("p95Combined", 0) or r.get("p95Sent", 0) or 0
            }
            for r in sorted(customer_reports, key=lambda x: x["month"])
        ]
        
        # Get capacity
        capacity = customer_reports[-1].get("capacity", 100e6)  # Default 100 Mbps
        
        # Forecast
        result = forecast_customer_p95(
            customer_id=customer_id,
            historical_data=historical_p95,
            capacity=capacity
        )
        
        result["customer_name"] = customer_reports[-1].get("customerName", "")
        result["customer_type"] = customer_type
        result["historical_months"] = len(historical_p95)
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/dashboard/insights")
async def get_dashboard_insights():
    """
    Get ML insights for dashboard display.
    Returns summary of anomalies and forecasts across all customers.
    """
    try:
        insights = {
            "timestamp": datetime.now().isoformat(),
            "anomaly_summary": {
                "total_analyzed": 0,
                "anomalies_detected": 0,
                "critical_count": 0,
                "warning_count": 0
            },
            "forecast_summary": {
                "total_forecasted": 0,
                "upgrades_recommended": 0,
                "high_urgency": 0,
                "medium_urgency": 0
            },
            "recent_anomalies": [],
            "upgrade_recommendations": []
        }
        
        # Fetch recent reports to generate insights
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(f"{BACKEND_URL}/percentile-reports")
                if response.status_code == 200:
                    data = response.json()
                    reports = data.get("reports", [])
                    
                    # Analyze reports for insights
                    for report in reports[-50:]:  # Last 50 reports
                        capacity = report.get("capacity", 100e6)
                        p95 = report.get("p95Combined", 0)
                        
                        if capacity > 0 and p95 > 0:
                            utilization = (p95 / capacity) * 100
                            
                            if utilization > 90:
                                insights["forecast_summary"]["high_urgency"] += 1
                                insights["upgrade_recommendations"].append({
                                    "customer_name": report.get("customerName"),
                                    "customer_id": report.get("customerId"),
                                    "utilization": utilization,
                                    "urgency": "high"
                                })
                            elif utilization > 80:
                                insights["forecast_summary"]["medium_urgency"] += 1
                            
                            insights["forecast_summary"]["total_forecasted"] += 1
                    
                    insights["forecast_summary"]["upgrades_recommended"] = (
                        insights["forecast_summary"]["high_urgency"] +
                        insights["forecast_summary"]["medium_urgency"]
                    )
            except:
                pass  # Backend might not be available
        
        return insights
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Run Server ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)

