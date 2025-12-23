"""
Traffic Anomaly Detection Module

Uses multiple methods to detect anomalies in network traffic:
1. Isolation Forest - for detecting outliers in multivariate data
2. Z-Score - for simple statistical outlier detection
3. Moving Average - for detecting deviations from recent trends
"""

import numpy as np
from sklearn.ensemble import IsolationForest
from scipy import stats
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from datetime import datetime


@dataclass
class AnomalyResult:
    """Result of anomaly detection"""
    is_anomaly: bool
    confidence: float  # 0-1 score
    anomaly_type: str  # 'spike', 'drop', 'unusual_pattern', 'normal'
    message: str
    details: Dict


class TrafficAnomalyDetector:
    """
    Detects anomalies in network traffic data using multiple methods.
    """
    
    def __init__(
        self,
        contamination: float = 0.05,
        z_threshold: float = 2.5,
        window_size: int = 10
    ):
        """
        Initialize the anomaly detector.
        
        Args:
            contamination: Expected proportion of anomalies (0-0.5)
            z_threshold: Z-score threshold for statistical anomaly
            window_size: Window size for moving average calculations
        """
        self.contamination = contamination
        self.z_threshold = z_threshold
        self.window_size = window_size
        self.isolation_forest = IsolationForest(
            contamination=contamination,
            random_state=42,
            n_estimators=100
        )
        self._is_trained = False
    
    def train(self, historical_data: np.ndarray) -> None:
        """
        Train the anomaly detector on historical traffic data.
        
        Args:
            historical_data: Array of shape (n_samples, n_features)
                            Features: [input_traffic, output_traffic, timestamp_hour, day_of_week]
        """
        if len(historical_data) < 50:
            raise ValueError("Need at least 50 data points for training")
        
        # Reshape if 1D
        if historical_data.ndim == 1:
            historical_data = historical_data.reshape(-1, 1)
        
        self.isolation_forest.fit(historical_data)
        self._is_trained = True
        
        # Store statistics for z-score method
        self.mean = np.mean(historical_data, axis=0)
        self.std = np.std(historical_data, axis=0)
        self.std = np.where(self.std == 0, 1, self.std)  # Avoid division by zero
    
    def detect_anomaly(
        self,
        current_value: float,
        recent_values: List[float],
        input_traffic: Optional[float] = None,
        output_traffic: Optional[float] = None
    ) -> AnomalyResult:
        """
        Detect if the current traffic value is anomalous.
        
        Args:
            current_value: Current traffic value (bps)
            recent_values: List of recent traffic values for context
            input_traffic: Optional separate input traffic value
            output_traffic: Optional separate output traffic value
            
        Returns:
            AnomalyResult with detection details
        """
        results = []
        
        # Method 1: Z-Score detection
        z_result = self._zscore_detection(current_value, recent_values)
        results.append(('zscore', z_result))
        
        # Method 2: Moving average deviation
        ma_result = self._moving_average_detection(current_value, recent_values)
        results.append(('moving_avg', ma_result))
        
        # Method 3: Isolation Forest (if trained)
        if self._is_trained and input_traffic is not None and output_traffic is not None:
            if_result = self._isolation_forest_detection(input_traffic, output_traffic)
            results.append(('isolation_forest', if_result))
        
        # Method 4: Sudden change detection
        sc_result = self._sudden_change_detection(current_value, recent_values)
        results.append(('sudden_change', sc_result))
        
        # Combine results using voting
        return self._combine_results(results, current_value, recent_values)
    
    def _zscore_detection(
        self,
        current_value: float,
        recent_values: List[float]
    ) -> Tuple[bool, float, str]:
        """Z-score based anomaly detection"""
        if len(recent_values) < 3:
            return (False, 0.0, "insufficient_data")
        
        mean = np.mean(recent_values)
        std = np.std(recent_values)
        
        if std == 0:
            return (False, 0.0, "no_variance")
        
        z_score = abs((current_value - mean) / std)
        is_anomaly = z_score > self.z_threshold
        confidence = min(z_score / (self.z_threshold * 2), 1.0)
        
        if is_anomaly:
            if current_value > mean:
                anomaly_type = "spike"
            else:
                anomaly_type = "drop"
        else:
            anomaly_type = "normal"
        
        return (is_anomaly, confidence, anomaly_type)
    
    def _moving_average_detection(
        self,
        current_value: float,
        recent_values: List[float]
    ) -> Tuple[bool, float, str]:
        """Moving average based anomaly detection"""
        if len(recent_values) < self.window_size:
            return (False, 0.0, "insufficient_data")
        
        ma = np.mean(recent_values[-self.window_size:])
        deviation = abs(current_value - ma) / ma if ma > 0 else 0
        
        # 50% deviation from moving average is suspicious
        is_anomaly = deviation > 0.5
        confidence = min(deviation, 1.0)
        
        if is_anomaly:
            anomaly_type = "spike" if current_value > ma else "drop"
        else:
            anomaly_type = "normal"
        
        return (is_anomaly, confidence, anomaly_type)
    
    def _isolation_forest_detection(
        self,
        input_traffic: float,
        output_traffic: float
    ) -> Tuple[bool, float, str]:
        """Isolation Forest based anomaly detection"""
        X = np.array([[input_traffic, output_traffic]])
        
        # Get anomaly score (-1 for anomaly, 1 for normal)
        prediction = self.isolation_forest.predict(X)[0]
        
        # Get anomaly score (negative means more anomalous)
        score = self.isolation_forest.score_samples(X)[0]
        
        is_anomaly = prediction == -1
        # Convert score to confidence (scores are typically -0.5 to 0.5)
        confidence = max(0, min(1, 0.5 - score))
        
        return (is_anomaly, confidence, "unusual_pattern" if is_anomaly else "normal")
    
    def _sudden_change_detection(
        self,
        current_value: float,
        recent_values: List[float]
    ) -> Tuple[bool, float, str]:
        """Detect sudden changes from the previous value"""
        if len(recent_values) < 1:
            return (False, 0.0, "insufficient_data")
        
        prev_value = recent_values[-1]
        
        if prev_value == 0:
            return (False, 0.0, "zero_previous")
        
        change_ratio = abs(current_value - prev_value) / prev_value
        
        # 100% change in one interval is suspicious
        is_anomaly = change_ratio > 1.0
        confidence = min(change_ratio / 2, 1.0)
        
        if is_anomaly:
            anomaly_type = "spike" if current_value > prev_value else "drop"
        else:
            anomaly_type = "normal"
        
        return (is_anomaly, confidence, anomaly_type)
    
    def _combine_results(
        self,
        results: List[Tuple[str, Tuple[bool, float, str]]],
        current_value: float,
        recent_values: List[float]
    ) -> AnomalyResult:
        """Combine results from multiple detection methods"""
        anomaly_votes = 0
        total_confidence = 0
        anomaly_types = []
        method_details = {}
        
        for method_name, (is_anomaly, confidence, anomaly_type) in results:
            method_details[method_name] = {
                "is_anomaly": is_anomaly,
                "confidence": confidence,
                "type": anomaly_type
            }
            
            if is_anomaly:
                anomaly_votes += 1
                total_confidence += confidence
                if anomaly_type not in ["normal", "insufficient_data"]:
                    anomaly_types.append(anomaly_type)
        
        # Need at least 2 methods to agree for an anomaly
        is_final_anomaly = anomaly_votes >= 2
        
        if is_final_anomaly and anomaly_votes > 0:
            avg_confidence = total_confidence / anomaly_votes
            # Determine the most common anomaly type
            if anomaly_types:
                final_type = max(set(anomaly_types), key=anomaly_types.count)
            else:
                final_type = "unusual_pattern"
        else:
            avg_confidence = 0.0
            final_type = "normal"
        
        # Generate message
        if is_final_anomaly:
            if final_type == "spike":
                message = f"Traffic spike detected: {self._format_bytes(current_value)} (unusual high)"
            elif final_type == "drop":
                message = f"Traffic drop detected: {self._format_bytes(current_value)} (unusual low)"
            else:
                message = f"Unusual traffic pattern detected: {self._format_bytes(current_value)}"
        else:
            message = f"Traffic normal: {self._format_bytes(current_value)}"
        
        return AnomalyResult(
            is_anomaly=is_final_anomaly,
            confidence=avg_confidence,
            anomaly_type=final_type,
            message=message,
            details={
                "current_value": current_value,
                "recent_avg": np.mean(recent_values) if recent_values else 0,
                "methods": method_details,
                "votes": f"{anomaly_votes}/{len(results)}"
            }
        )
    
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


def analyze_traffic_anomalies(
    traffic_data: List[Dict],
    look_back_hours: int = 24
) -> Dict:
    """
    Analyze a list of traffic data points for anomalies.
    
    Args:
        traffic_data: List of dicts with 'timestamp', 'input', 'output' keys
        look_back_hours: Hours of data to consider for baseline
        
    Returns:
        Dict with anomaly analysis results
    """
    if len(traffic_data) < 10:
        return {
            "status": "insufficient_data",
            "message": "Need at least 10 data points for analysis",
            "anomalies": []
        }
    
    detector = TrafficAnomalyDetector()
    
    # Extract values
    inputs = [d.get('input', 0) for d in traffic_data]
    outputs = [d.get('output', 0) for d in traffic_data]
    combined = [i + o for i, o in zip(inputs, outputs)]
    
    # Train on historical data (all but last point)
    if len(traffic_data) >= 50:
        training_data = np.column_stack([inputs[:-1], outputs[:-1]])
        detector.train(training_data)
    
    # Analyze the most recent points
    anomalies = []
    for i in range(max(10, len(traffic_data) - 10), len(traffic_data)):
        result = detector.detect_anomaly(
            current_value=combined[i],
            recent_values=combined[max(0, i-20):i],
            input_traffic=inputs[i],
            output_traffic=outputs[i]
        )
        
        if result.is_anomaly:
            anomalies.append({
                "index": i,
                "timestamp": traffic_data[i].get('timestamp'),
                "type": result.anomaly_type,
                "confidence": result.confidence,
                "message": result.message,
                "input": inputs[i],
                "output": outputs[i],
                "details": result.details
            })
    
    # Calculate overall health score
    recent_anomaly_count = len([a for a in anomalies if a['index'] >= len(traffic_data) - 5])
    health_score = max(0, 100 - (recent_anomaly_count * 20))
    
    return {
        "status": "analyzed",
        "total_points": len(traffic_data),
        "anomaly_count": len(anomalies),
        "health_score": health_score,
        "health_status": "healthy" if health_score >= 80 else "warning" if health_score >= 50 else "critical",
        "anomalies": anomalies[-10:],  # Return last 10 anomalies
        "summary": {
            "avg_input": np.mean(inputs),
            "avg_output": np.mean(outputs),
            "max_input": max(inputs),
            "max_output": max(outputs),
            "current_input": inputs[-1] if inputs else 0,
            "current_output": outputs[-1] if outputs else 0
        }
    }

