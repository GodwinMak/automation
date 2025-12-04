const { exec } = require("child_process");
const db = require("../Models");
const cron = require("node-cron");

module.exports = () => {
  const checkPing = (device) => {
    return new Promise((resolve) => {
      // Ping command for Linux/macOS
      const command = `ping -c 1 -W 1 ${device.ip}`;

      // For Windows, use 'ping -n 1 -w 1000'
      // const command = `ping -n 1 -w 1000 ${ip}`;

      const name  = device.name
      const ip = device.ip

      exec(command, (error, stdout, stderr) => {
        // If there's no error, the ping was successful.
        const isUp = !error;
        resolve({ name, ip, isUp, output: stdout + stderr });
      });
    });
  };

  // Main function to fetch all devices and check their status
  const monitorDevices = async () => {
    try {
      // 1. Fetch all devices from the database using Sequelize
      const devices = await db.devices.findAll({
        attributes: ["name", "ip"],
      });

      console.log(`Found ${devices.length} devices to check.`);

      // 2. Ping each device concurrently
      const pingPromises = devices.map((device) =>
        checkPing(device)
      );
      const results = await Promise.all(pingPromises);
      // 3. Process results and log status
      console.log("\n--- Device Status Report ---");
      results.forEach((result) => {
        if (result.isUp) {
        //   console.log(`✅ ${result.name}  ${result.ip} is UP`);
        } else {
          console.log(`❌ ${result.name} ${result.ip} is DOWN`);
        }
      });

      return results;
    } catch (err) {
      console.error("An error occurred:", err.message);
    }
  };

  // Schedule the task to run every 5 minutes
  cron.schedule('*/30 * * * *', monitorDevices);
  // monitorDevices();

  return {
    monitorDevices,
  };
};
