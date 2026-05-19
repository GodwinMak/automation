const cron = require("node-cron");
const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const db = require("../Models");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = () => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
  };
  const Device = db.devices;
  const SwitchConfiguration = db.switchConfiguration;
  const { Op } = db.Sequelize;
  const outputDir = path.join(__dirname, "..", "SwitchConfigs");

  // === HELPER FUNCTIONS ===
  // Run command over SSH
  const runCommand = (host, cmd) => {
    console.log(host, cmd)
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let result = "";
      conn
        .on("ready", () => {
          conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            stream
              .on("data", (data) => {
                result += data.toString();
              })
              .on("close", () => {
                conn.end();
                resolve(result.trim());
              });
          });
        })
        .on("error", (err) => reject(err))
        .connect({ host, ...sshConfig });
    });
  };

  const runCommandWithTimeout = (host, cmd, timeoutMs) => {
    return Promise.race([
      runCommand(host, cmd),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Command timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  };

  const sanitizeFilenamePart = (value) => {
    return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
  };

  const ensureOutputDir = () => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  };

  const updateSwitchConfiguration = async () => {
    try {
      ensureOutputDir();
      const devices = await Device.findAll({
        attributes: ["id", "name", "ip"],
        where: {
          name: {
            [Op.ne]: "SME-HOME-BM",
          },
        },
      });

      const skipped = [];
      let savedCount = 0;

      for (const dev of devices) {
        try {
          console.log(`[INFO] Fetching config for ${dev.name} (${dev.ip})`);

          const configuration = await runCommandWithTimeout(
            dev.ip,
            "show configuration |display set |no-more",
            180000,
          );

          const safeName = sanitizeFilenamePart(dev.name);
          const safeIp = sanitizeFilenamePart(dev.ip);
          const fileName = `${safeName}_${safeIp}.txt`;
          const filePath = path.join(outputDir, fileName);
          await fs.promises.writeFile(filePath, configuration + "\n", "utf8");

          const existing = await SwitchConfiguration.findOne({
            where: { deviceId: dev.id },
          });

          if (existing) {
            await existing.update({
              deviceName: dev.name,
              filePath,
            });
          } else {
            await SwitchConfiguration.create({
              deviceId: dev.id,
              deviceName: dev.name,
              filePath,
            });
          }

          savedCount += 1;
          console.log(`[INFO] Saved config for ${dev.name} to ${filePath}`);
        } catch (error) {
          skipped.push({ name: dev.name, reason: error.message });
          console.warn(
            `[WARN] Skipping ${dev.name} (${dev.ip}): ${error.message}`,
          );
        }
      }

      console.log(`[INFO] Saved ${savedCount} switch configurations.`);

      if (skipped.length > 0) {
        console.warn(
          `[WARN] Skipped switches: ${skipped
            .map((item) => `${item.name} (${item.reason})`)
            .join(", ")}`,
        );
      }
    } catch (error) {
      console.error("[ERROR] Fatal error:", error.message);
    }
  };

//   return updateSwitchConfiguration();
 const runAll = async ()=>{
    try {
        await updateSwitchConfiguration();
    } catch (error) {
      console.error("[Main Runner] Fatal error:", error.message);
    }
 }

  cron.schedule("0 */2 * * *", () => {
    console.log("[Switch Config] Cron job running every 2 hours.");
    runAll();
  });

  // runAll();

 return {
    updateSwitchConfiguration,
 };
};
