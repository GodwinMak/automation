# Network Traffic ML Service

Machine Learning microservice for network traffic analysis, anomaly detection, and 95th percentile forecasting.

## Features

- **Traffic Anomaly Detection**: Detects unusual traffic patterns using multiple ML methods
  - Isolation Forest for multivariate anomaly detection
  - Z-Score statistical analysis
  - Moving average deviation detection
  - Sudden change detection

- **95th Percentile Forecasting**: Predicts future bandwidth usage
  - Linear regression trend analysis
  - Exponential smoothing
  - Confidence intervals
  - Upgrade recommendations

- **Capacity Planning**: Recommends bandwidth upgrades based on predicted usage

## Quick Start

### 1. Install Dependencies

```bash
cd ml-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment (Optional)

Create a `.env` file:

```env
ZABBIX_USERNAME=ltz-api
ZABBIX_PASSWORD=your_password
BACKEND_URL=http://localhost:4000
```

### 3. Run the Service

```bash
python main.py
```

Or with uvicorn directly:

```bash
uvicorn main:app --host 0.0.0.0 --port 5000 --reload
```

The service will be available at `http://localhost:5000`

## API Endpoints

### Health Check

```http
GET /
GET /health
```

### Anomaly Detection

```http
POST /analyze/anomalies
Content-Type: application/json

{
  "traffic_data": [
    {"timestamp": "2024-01-01T00:00:00", "input": 1000000, "output": 500000},
    {"timestamp": "2024-01-01T00:05:00", "input": 1100000, "output": 550000}
  ]
}
```

### Analyze from Zabbix

```http
POST /analyze/zabbix
Content-Type: application/json

{
  "switch_name": "LTZ-PE1-RAH",
  "interface_name": "ge-0/0/1",
  "hours": 24
}
```

### Analyze Customer

```http
GET /analyze/customer/{customer_id}?customer_type=DIA&hours=24
```

### P95 Forecast

```http
POST /forecast/p95
Content-Type: application/json

{
  "historical_p95": [
    {"month": "2024-01", "p95": 50000000},
    {"month": "2024-02", "p95": 55000000},
    {"month": "2024-03", "p95": 58000000}
  ],
  "capacity": 100000000
}
```

### Forecast Customer

```http
GET /forecast/customer/{customer_id}?customer_type=DIA
```

### Dashboard Insights

```http
GET /dashboard/insights
```

## Response Examples

### Anomaly Analysis Response

```json
{
  "status": "analyzed",
  "total_points": 100,
  "anomaly_count": 2,
  "health_score": 80,
  "health_status": "healthy",
  "anomalies": [
    {
      "index": 95,
      "timestamp": "2024-01-01T23:45:00",
      "type": "spike",
      "confidence": 0.85,
      "message": "Traffic spike detected: 150.00 Mbps (unusual high)"
    }
  ],
  "summary": {
    "avg_input": 50000000,
    "avg_output": 25000000,
    "max_input": 150000000,
    "max_output": 75000000,
    "current_input": 55000000,
    "current_output": 28000000
  }
}
```

### P95 Forecast Response

```json
{
  "customer_id": "123",
  "forecast": {
    "predicted_p95": 65000000,
    "predicted_p95_formatted": "65.00 Mbps",
    "confidence_low": 55000000,
    "confidence_high": 75000000,
    "trend": "increasing",
    "growth_rate_percent": 8.5
  },
  "capacity": {
    "current": 100000000,
    "current_formatted": "100.00 Mbps",
    "recommended": 100000000,
    "recommended_formatted": "100.00 Mbps",
    "needs_upgrade": false,
    "urgency": "none"
  },
  "message": "Capacity sufficient: Predicted usage 65.00 Mbps (65.0% of capacity)"
}
```

## Integration

### Node.js Backend

The ML service is integrated via `/ml` routes in the backend:

```javascript
// Example: Analyze customer anomalies
const response = await axios.get('http://localhost:4000/ml/analyze/customer/123?customerType=DIA');
```

### Web App

Import and use the ML components:

```tsx
import MLInsights from "@/components/MLInsights";
import CustomerMLAnalysis from "@/components/CustomerMLAnalysis";

// Dashboard
<MLInsights />

// Customer detail page
<CustomerMLAnalysis
  customerId="123"
  customerType="DIA"
  customerName="Customer Name"
/>
```

## Architecture

```
ml-service/
├── main.py              # FastAPI application
├── config.py            # Configuration
├── requirements.txt     # Dependencies
├── models/
│   ├── __init__.py
│   ├── anomaly_detector.py   # Anomaly detection logic
│   └── traffic_forecaster.py # P95 forecasting logic
└── data/                # Data storage (optional)
```

## Development

### Running Tests

```bash
pytest tests/
```

### Code Style

```bash
black .
flake8 .
```

## License

Internal use only - Liquid Telecom Tanzania

