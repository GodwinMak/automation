/**
 * Device Warehouse Sync (weekly reconciliation)
 *
 * Controller/devices.js already pushes a warehouse event on every create/
 * update/delete, so this job normally has nothing to do. It exists as a
 * safety net for drift the event-driven path can't see — e.g. a device row
 * edited directly in the DB, or an event lost during downtime — by diffing
 * the full device list against last week's snapshot and only pushing what
 * actually changed.
 */
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const db = require("../Models");
const { enqueueEvent } = require("../utils/warehouseSpool");

const SNAPSHOT_FILE = path.join(__dirname, "..", "state", "deviceWarehouseSnapshot.json");

const loadSnapshot = () => {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  } catch {
    return {};
  }
};

const saveSnapshot = (snapshot) => {
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot));
};

const toRecord = (device) => ({
  ip: device.ip,
  name: device.name,
  lat: device.lat,
  long: device.long,
});

const hasChanged = (previous, current) =>
  !previous ||
  previous.ip !== current.ip ||
  previous.name !== current.name ||
  String(previous.lat) !== String(current.lat) ||
  String(previous.long) !== String(current.long);

const runDeviceWarehouseSync = async () => {
  console.log("[Device Warehouse Sync] Checking for device changes…");
  try {
    const devices = await db.devices.findAll({
      attributes: ["id", "ip", "name", "lat", "long"],
      raw: true,
    });
    const previous = loadSnapshot();
    const current = {};
    let added = 0, updated = 0, removed = 0;

    for (const device of devices) {
      current[device.id] = toRecord(device);
      if (hasChanged(previous[device.id], current[device.id])) {
        previous[device.id] ? updated++ : added++;
        enqueueEvent("DEVICE", device.id, { id: device.id, ...current[device.id], deletedAt: null });
      }
    }

    for (const id of Object.keys(previous)) {
      if (!current[id]) {
        removed++;
        enqueueEvent("DEVICE", id, { id, ...previous[id], deletedAt: new Date() });
      }
    }

    saveSnapshot(current);
    console.log(`[Device Warehouse Sync] added=${added} updated=${updated} removed=${removed}`);
  } catch (err) {
    console.error("[Device Warehouse Sync] Error:", err.message);
  }
};

const scheduleDeviceWarehouseSync = () => {
  // Every Monday at 03:00
  cron.schedule("0 3 * * 1", () => {
    runDeviceWarehouseSync();
  });
  console.log("[Device Warehouse Sync] Weekly cron scheduled (Mondays 03:00).");
};

module.exports = { scheduleDeviceWarehouseSync, runDeviceWarehouseSync };
