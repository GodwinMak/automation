const db = require("./Models"); // adjust path to your models folder
const fs = require("fs");

const Device = db.devices;

async function seed() {
  try {
    const data = JSON.parse(fs.readFileSync("./devices.json", "utf-8"));

    const toDecimal = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number") return value;
      const normalized = String(value).replace(/\s+/g, "").replace(/°/g, "");
      const parsed = Number.parseFloat(normalized);
      return Number.isNaN(parsed) ? null : parsed;
    };

    // Transform to match DB fields and normalize lat/long
    const devices = data.map((d) => ({
      ip: d.ip,
      name: d.name,
      lat: toDecimal(d.lat),
      long: toDecimal(d.long),
    }));

    await Device.bulkCreate(devices, {
      updateOnDuplicate: ["name", "lat", "long"],
    });

    console.log("✅ Devices seeded successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error seeding devices:", err);
    process.exit(1);
  }
}

seed();
