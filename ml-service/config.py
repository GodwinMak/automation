import os
from dotenv import load_dotenv

load_dotenv()

# Zabbix API Configuration
ZABBIX_API_URL = "https://monitoring.liquidtelecom.net/api_jsonrpc.php"
ZABBIX_USERNAME = os.getenv("ZABBIX_USERNAME", "godwin.makyao@liquidtech.co.tz")
ZABBIX_PASSWORD = os.getenv("ZABBIX_PASSWORD", "Namwel@842001!#@")

# Backend API Configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")

# ML Model Configuration
ANOMALY_CONTAMINATION = 0.05  # Expected proportion of anomalies
ANOMALY_SENSITIVITY = 1.5     # Standard deviations for threshold
FORECAST_HORIZON_DAYS = 30    # Days to forecast ahead

# Cache Configuration
CACHE_TTL_SECONDS = 300  # 5 minutes

