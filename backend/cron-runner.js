// cron-runner.js
const path = require("path");
const Redis = require("ioredis");
require("dotenv").config({ path: path.join(__dirname, ".env") });

process.env.CRON_WORKER = "1";

// Get the specific task name passed by PM2
const task = process.argv[2]; 
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const DIAGNOSIS_REQUEST_CHANNEL = "diagnosis:requests";
const DIAGNOSIS_TIMING_ENABLED = process.env.DIAGNOSIS_TIMING_ENABLED !== "0";

function logDiagnosisWorkerTime(label, startedAt, extra = "") {
  if (!DIAGNOSIS_TIMING_ENABLED) return;
  const suffix = extra ? ` ${extra}` : "";
  console.log(`[Diagnosis Timing] ${label} took ${Date.now() - startedAt}ms${suffix}`);
}

async function startDiagnosisWorker() {
  process.env.DIAGNOSIS_WORKER_PROCESS = "1";
  const { runDiagnosisDirect } = require(path.join(__dirname, "Controller/diagnosis"));
  const subscriber = new Redis(REDIS_URL, { lazyConnect: true });
  const publisher = new Redis(REDIS_URL, { lazyConnect: true });

  subscriber.on("error", (error) => {
    console.error("[Diagnosis Worker] Redis subscriber error:", error.message);
  });
  publisher.on("error", (error) => {
    console.error("[Diagnosis Worker] Redis publisher error:", error.message);
  });

  await Promise.all([subscriber.connect(), publisher.connect()]);
  await subscriber.subscribe(DIAGNOSIS_REQUEST_CHANNEL);

  subscriber.on("message", async (_channel, rawMessage) => {
    const jobStartedAt = Date.now();
    let job;
    try {
      job = JSON.parse(rawMessage);
      if (!job.responseChannel || !job.type) return;
      console.log(`[Diagnosis Timing] worker received job type=${job.type} requestId=${job.requestId || "unknown"}`);

      const result = await runDiagnosisDirect(job.type, job.body || {});
      logDiagnosisWorkerTime(
        "worker job execution",
        jobStartedAt,
        `type=${job.type} requestId=${job.requestId || "unknown"} status=${result.statusCode || 200}`
      );
      const publishStartedAt = Date.now();
      await publisher.publish(job.responseChannel, JSON.stringify(result));
      logDiagnosisWorkerTime(
        "worker response publish",
        publishStartedAt,
        `type=${job.type} requestId=${job.requestId || "unknown"}`
      );
    } catch (error) {
      logDiagnosisWorkerTime(
        "worker job execution",
        jobStartedAt,
        `type=${job?.type || "unknown"} requestId=${job?.requestId || "unknown"} failed=${error.message}`
      );
      if (job?.responseChannel) {
        const publishStartedAt = Date.now();
        await publisher.publish(job.responseChannel, JSON.stringify({
          statusCode: 500,
          data: { message: "Diagnosis worker failed", error: error.message },
        }));
        logDiagnosisWorkerTime(
          "worker error response publish",
          publishStartedAt,
          `type=${job.type || "unknown"} requestId=${job.requestId || "unknown"}`
        );
      } else {
        console.error("[Diagnosis Worker] Invalid job:", error.message);
      }
    }
  });

  console.log(`🩺 Diagnosis request worker listening on ${DIAGNOSIS_REQUEST_CHANNEL}.`);
}

async function initWorker() {
  try {
    console.log(`[Worker: ${task}] Starting from ${__dirname}`);

    if (task === "Diagnosis") {
      await startDiagnosisWorker();
      return;
    }

    const db = require(path.join(__dirname, "Models"));
    await db.sequelize.authenticate();
    console.log(`💾 [Worker: ${task}] Database connection securely established.`);

    // Pass null for 'io' layer to prevent clustering conflicts or crashes
    switch (task) {
      case "DIA":
        require(path.join(__dirname, "cron/updateDIA"))(null);
        console.log("⏰ DIA sync engine started on 5-minute interval cycles.");
        break;
      case "IPT":
        require(path.join(__dirname, "cron/updateIPT"))(null);
        console.log("⏰ IPT sync engine started on 5-minute interval cycles.");
        break;
      case "Shared":
        require(path.join(__dirname, "cron/updateShared"))(null);
        console.log("⏰ Shared infrastructure sync engine started.");
        break;
      case "L3VPN":
        require(path.join(__dirname, "cron/updateL3VPN.js"))(null);
        console.log("⏰ L3VPN customer sync engine started.");
        break;
      case "FTTH":
        require(path.join(__dirname, "cron/updateFTTH.js"))(null);
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
