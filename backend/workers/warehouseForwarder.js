require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SPOOL_FILE = path.join(
  __dirname,
  "..",
  "spool",
  "warehouse_events.ndjson",
);
const PROCESSING_FILE = SPOOL_FILE + ".processing";
const BATCH_SIZE = 500;
const POLL_INTERVAL_MS = 15000;

const INGEST_URL = process.env.WAREHOUSE_INGEST_URL;
const API_KEY = process.env.WAREHOUSE_API_KEY;

let backoffMs = 5000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

async function sendBatch(events) {
  await axios.post(INGEST_URL, events, {
    headers: { "x-api-key": API_KEY },
    timeout: 10000,
  });
}

async function processOnce() {
  if (!fs.existsSync(SPOOL_FILE)) return;

  try {
    fs.renameSync(SPOOL_FILE, PROCESSING_FILE);
  } catch (err) {
    return;
  }

  const lines = fs
    .readFileSync(PROCESSING_FILE, "utf8")
    .split("\n")
    .filter(Boolean);

  let cursor = 0;
  while (cursor < lines.length) {
    const chunk = lines.slice(cursor, cursor + BATCH_SIZE).map(JSON.parse);
    try {
      await sendBatch(chunk);
      cursor += BATCH_SIZE;
      backoffMs = 5000;
    } catch (err) {
      console.warn(
        "[forwarder] send failed, will retry with backoff:",
        err.message,
      );
      const remaining = lines.slice(cursor);
      fs.appendFileSync(SPOOL_FILE, remaining.join("\n") + "\n");
      fs.unlinkSync(PROCESSING_FILE);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      await new Promise((r) => setTimeout(r, backoffMs));
      return;
    }
  }

  fs.unlinkSync(PROCESSING_FILE);
}

async function loop() {
  while (true) {
    await processOnce();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
