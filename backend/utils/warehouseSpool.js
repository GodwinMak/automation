const fs = require("fs");
const path = require("path");

const SPOOL_DIR = path.join(__dirname, "..", "spool");
const SPOOL_FILE = path.join(SPOOL_DIR, "warehouse_events.ndjson");
const MAX_SPOOL_BYTES = 200 * 1024 * 1024; // 200MB safety cap

if (!fs.existsSync(SPOOL_DIR)) fs.mkdirSync(SPOOL_DIR, { recursive: true });

function enqueueEvent(
  serviceType,
  recordKey,
  payload,
  cid = null,
  pollTs = new Date(),
) {
  try {
    const stat = fs.existsSync(SPOOL_FILE) ? fs.statSync(SPOOL_FILE) : null;
    if (stat && stat.size > MAX_SPOOL_BYTES) {
      console.warn(
        "[warehouseSpool] spool file over cap, dropping event to protect disk",
      );
      return;
    }

    const line =
      JSON.stringify({
        service_type: serviceType,
        poll_ts: pollTs.toISOString().slice(0, 19).replace("T", " "),
        source_host: require("os").hostname(),
        record_key: recordKey,
        cid,
        payload,
      }) + "\n";

    fs.appendFile(SPOOL_FILE, line, (err) => {
      if (err)
        console.warn(
          "[warehouseSpool] append failed (non-fatal):",
          err.message,
        );
    });
  } catch (err) {
    console.warn("[warehouseSpool] enqueue error (non-fatal):", err.message);
  }
}

function enqueueBatch(serviceType, records) {
  for (const r of records) {
    enqueueEvent(serviceType, r.record_key, r.payload, r.cid, r.poll_ts);
  }
}

module.exports = { enqueueEvent, enqueueBatch };
