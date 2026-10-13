import 'dotenv/config';

const WAREHOUSE_API_HOST = process.env.WAREHOUSE_API_HOST; // e.g. http://10.10.10.1:4000
const WAREHOUSE_API_KEY = process.env.WAREHOUSE_API_KEY;

// Without an explicit timeout, a dead/unreachable warehouse server (or a
// route that exists on the ingest side but was never implemented for
// reads — see the doc comment on getLinkHistory below) hangs this fetch
// indefinitely. That silently eats the ENTIRE agent loop's budget
// (AI_AGENT_TIMEOUT_MS in main.js, 6 minutes) on a single tool call,
// instead of failing fast with a clear error the model — and the
// specialist agent that called it — can actually react to.
const WAREHOUSE_FETCH_TIMEOUT_MS = 10000;

async function warehouseFetch(path) {
  if (!WAREHOUSE_API_HOST || !WAREHOUSE_API_KEY) {
    throw new Error('Missing WAREHOUSE_API_HOST / WAREHOUSE_API_KEY in .env');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAREHOUSE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${WAREHOUSE_API_HOST}${path}`, {
      headers: { 'x-api-key': WAREHOUSE_API_KEY },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        `Warehouse server at ${WAREHOUSE_API_HOST} did not respond within ${WAREHOUSE_FETCH_TIMEOUT_MS / 1000}s — it may be unreachable, or this endpoint may not be implemented there yet.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Raw poll history for one link/customer record over an optional date
 * range. Mirrors GET /history/:service/:recordKey on the warehouse ingest
 * API (deployed at /opt/warehouse-ingest/server.js on the warehouse
 * server — not part of this repo).
 */
export async function getLinkHistory(service, recordKey, from, to) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await warehouseFetch(
    `/history/${encodeURIComponent(service)}/${encodeURIComponent(recordKey)}${qs}`
  );
  if (!res.ok) {
    throw new Error(`Warehouse history query failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { count, history: [{ poll_ts, payload_json }, ...] }
}

/**
 * Latest known state for one link/customer record, from current_status —
 * cheaper than crawling history when you only need "what is it right now
 * as last recorded by the warehouse" (NOT a live device query — this
 * reflects the last poll, which can be up to one polling interval old).
 */
export async function getCurrentStatus(service, recordKey) {
  const res = await warehouseFetch(
    `/current/${encodeURIComponent(service)}/${encodeURIComponent(recordKey)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Warehouse current-status query failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { poll_ts, source_host, cid, payload_json, updated_at }
}

/**
 * Daily-averaged metric trend for one link/customer record (e.g.
 * util_pct, down_mbps, is_up) over a lookback window, from
 * network_daily_metrics — the pre-aggregated table, not a raw per-poll
 * scan, so this stays fast regardless of how much history exists.
 */
export async function getMetricTrend(service, recordKey, metric, days = 30) {
  const params = new URLSearchParams({ metric, days: String(days) });
  const res = await warehouseFetch(
    `/metrics/${encodeURIComponent(service)}/${encodeURIComponent(recordKey)}?${params.toString()}`
  );
  if (!res.ok) {
    throw new Error(`Warehouse metrics query failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { count, metric, days, trend: [{ day, metric_value, sample_count }, ...] }
}
