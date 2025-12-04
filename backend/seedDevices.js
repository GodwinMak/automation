const db = require("./Models"); // adjust path to your models folder
const fs = require("fs");

const Device = db.devices;

async function seed() {
  try {
    const data = JSON.parse(fs.readFileSync("./devices.json", "utf-8"));

    // Transform to match DB fields
    const devices = data.map(d => ({
      ip: d.IP,
      name: d.NAME
    }));

    await Device.bulkCreate(devices, { ignoreDuplicates: true });

    console.log("✅ Devices seeded successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error seeding devices:", err);
    process.exit(1);
  }
}

seed();
