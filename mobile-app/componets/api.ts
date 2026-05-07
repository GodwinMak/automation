// utils/api.ts

import { API_BASE, API_TIMEOUT } from "./Constants";
import { ImpactDataResponse } from "./isis";

export class APIError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "APIError";
  }
}

/**
 * Fetch ISIS impact analysis data from backend
 */
export async function fetchISISData(): Promise<ImpactDataResponse> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const response = await fetch(`${API_BASE}/impact-data`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new APIError(
        `API returned ${response.status}: ${response.statusText}`,
        "HTTP_ERROR",
        response.status
      );
    }

    const data = await response.json();

    // Validate response structure
    if (!Array.isArray(data.allEdges)) {
      throw new APIError("Invalid response: allEdges is not an array", "INVALID_RESPONSE");
    }

    return {
      allEdges: data.allEdges || [],
      downLinks: data.downLinks || [],
      nodeIPs: data.nodeIPs || {},
    };
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }

    if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
      throw new APIError(
        "Network error: Unable to connect to server",
        "NETWORK_ERROR"
      );
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new APIError(
        `Request timeout after ${API_TIMEOUT}ms`,
        "TIMEOUT"
      );
    }

    throw new APIError(
      error instanceof Error ? error.message : "Unknown error",
      "UNKNOWN_ERROR"
    );
  }
}

/**
 * Get error message for display
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    switch (error.code) {
      case "NETWORK_ERROR":
        return "🌐 Network Error: Check your connection and server status";
      case "TIMEOUT":
        return "⏱️ Request Timeout: Server is taking too long to respond";
      case "HTTP_ERROR":
        return `Server Error (${error.statusCode}): Please try again`;
      case "INVALID_RESPONSE":
        return "Invalid server response: Please try again";
      default:
        return error.message;
    }
  }

  return error instanceof Error ? error.message : "Unknown error occurred";
}

/**
 * Retry API call with exponential backoff
 */
export async function fetchWithRetry(
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<ImpactDataResponse> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchISISData();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on validation errors
      if (error instanceof APIError && error.code === "INVALID_RESPONSE") {
        throw error;
      }

      // Wait before retrying (exponential backoff)
      if (i < maxRetries - 1) {
        const waitTime = delayMs * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError || new APIError("All retries failed", "RETRY_EXHAUSTED");
}
