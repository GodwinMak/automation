// cron-runner.js
const db = require("./Models");
require("dotenv").config({ path: "./.env" });

// Get the specific task name passed by PM2
const task = process.argv[2]; 

async function initWorker() {
  try {
    await db.sequelize.authenticate();
    console.log(`💾 [Worker: ${task}] Database connection securely established.`);

    // Pass null for 'io' layer to prevent clustering conflicts or crashes
    switch (task) {
      case "DIA":
        require("./cron/updateDIA")(null);
        console.log("⏰ DIA sync engine started on 5-minute interval cycles.");
        break;
      case "IPT":
        require("./cron/updateIPT")(null);
        console.log("⏰ IPT sync engine started on 5-minute interval cycles.");
        break;
      case "Shared":
        require("./cron/updateShared")(null);
        console.log("⏰ Shared infrastructure sync engine started.");
        break;
      case "L3VPN":
        require("./cron/updateL3VPN.js")(null);
        console.log("⏰ L3VPN customer sync engine started.");
        break;
      case "FTTH":
        require("./cron/updateFTTH.js")(null);
        console.log("⏰ FTTH infrastructure sync engine started.");
        break;
    //   case "ISIS":
    //     require("./cron/isisAdjacent")(null);
    //     console.log("⏰ IS-IS Adjacency tracking engine started on its own process.");
    //     break;
      default:
        console.error(`❌ Unknown background worker task identifier: ${task}`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ [Worker: ${task}] Initialization failed:`, error);
    process.exit(1);
  }
}

initWorker();