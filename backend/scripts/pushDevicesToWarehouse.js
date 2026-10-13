/**
 * One-off backfill: push every current device straight to the warehouse
 * ingest API, bypassing the spool/forwarder pipeline entirely.
 *
 * Usage (from backend/): node scripts/pushDevicesToWarehouse.js
 */
require("dotenv").config();
const os = require("os");
const axios = require("axios");
const db = require("../Models");

const INGEST_URL = process.env.WAREHOUSE_INGEST_URL;
const API_KEY = process.env.WAREHOUSE_API_KEY;

const toEvent = (device) => ({
  service_type: "DEVICE",
  poll_ts: new Date().toISOString().slice(0, 19).replace("T", " "),
  source_host: os.hostname(),
  record_key: device.id,
  cid: null,
  payload: {
    id: device.id,
    ip: device.ip,
    name: device.name,
    lat: device.lat,
    long: device.long,
    deletedAt: null,
  },
});

(async () => {
  if (!INGEST_URL || !API_KEY) {
    console.error("Missing WAREHOUSE_INGEST_URL or WAREHOUSE_API_KEY in .env");
    process.exit(1);
  }

  const devices = await db.devices.findAll({
    attributes: ["id", "ip", "name", "lat", "long"],
    raw: true,
  });

  if (devices.length === 0) {
    console.log("No devices found — nothing to push.");
    process.exit(0);
  }

  const events = devices.map(toEvent);

  try {
    const res = await axios.post(INGEST_URL, events, {
      headers: { "x-api-key": API_KEY },
      timeout: 20000,
    });
    console.log(`Pushed ${events.length} device events. Ingest response:`, res.data);
  } catch (err) {
    console.error("Push failed:", err.response?.data || err.message);
    process.exit(1);
  }

  process.exit(0);
})();
