const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Client } = require("ssh2");
const cors = require("cors");
require("dotenv").config({ path: "./.env" });
const db = require("./Models");
const Device = db.devices;
const path = require("path")

const app = express();
app.use(
  cors({
    origin: (origin, callback) => callback(null, origin || true),
    credentials: true,
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: (origin, cb) => cb(null, origin || true), credentials: true } });

// Redis adapter — lets every cluster instance share the same Socket.IO broadcast bus.
// Workers publish events to Redis; the adapter delivers them to all connected clients
// regardless of which server process holds the socket.
(async () => {
  try {
    const { createAdapter } = require("@socket.io/redis-adapter");
    const Redis = require("ioredis");

    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    const pubClient = new Redis(redisUrl, { lazyConnect: true });
    const subClient = pubClient.duplicate();

    const lastRedisErrorLogAt = new Map();
    const REDIS_ERROR_LOG_INTERVAL_MS = 30000;

    const logRedisError = (name) => (err) => {
      const now = Date.now();
      const lastAt = lastRedisErrorLogAt.get(name) || 0;
      if (now - lastAt < REDIS_ERROR_LOG_INTERVAL_MS) return;
      lastRedisErrorLogAt.set(name, now);
      console.error(`[Socket.IO] ${name} Redis error:`, err.message);
    };

    pubClient.on("error", logRedisError("pubClient"));
    subClient.on("error", logRedisError("subClient"));

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    console.log("[Socket.IO] Redis adapter connected:", redisUrl);

    // Subscribe to events published by cron worker processes.
    // Workers cannot call io.emit() directly (no sockets), so they publish here
    // and the server re-emits through the Redis-backed io so all cluster instances
    // broadcast to their connected clients.
    const workerSub = pubClient.duplicate();
    workerSub.on("error", logRedisError("workerSub"));
    await workerSub.connect();
    await workerSub.subscribe("socket.io:worker-events");
    workerSub.on("message", (_channel, message) => {
      try {
        const { event, payload } = JSON.parse(message);
        io.emit(event, payload);
      } catch (e) {
        console.error("[Socket.IO] Worker event parse error:", e.message);
      }
    });
    console.log("[Socket.IO] Subscribed to worker-events channel");
  } catch (err) {
    console.error("[Socket.IO] Redis adapter FAILED — falling back to in-memory (single process only):", err.message);
  }
})();

const deviceRoutes = require("./routes/device");
const upgradeRoutes = require("./routes/upgrade");
const statusRoutes = require("./routes/status");
const customerRoutes = require("./routes/customer");
const iptCustomerRoutes = require("./routes/iptcustomer");
const sharedCustomerRoutes = require("./routes/sharedcustomer");
const userRoutes = require("./routes/user");
const clientRoutes = require("./routes/client_db");
const searchRoutes = require("./routes/search");
const capacityRoutes = require("./routes/capacity");
const favoriteRoutes = require("./routes/favorite");
const uptimeHistoryRoutes = require("./routes/uptimeHistory");
const churnAnalysisRoutes = require("./routes/churnAnalysis");
const notificationRoutes = require("./routes/notification");
const exportRoutes = require("./routes/export");
const diagnosisRoutes = require("./routes/diagnosis");
const diaOverusageRoutes = require("./routes/diaOverusage");
const pitchForUpgradeRoutes = require("./routes/pitchForUpgrade");
const switchConfigurationRoutes = require("./routes/switchConfiguration");
const isisAdjacentRoutes = require("./routes/isisAdjacent");
const pushTokenRoutes = require("./routes/pushToken");
const l3vpnCustomerRoutes = require("./routes/l3vpncustomer");
const ftthCustomerRoutes = require("./routes/ftthcustomer");
const ftthReportRoutes = require("./routes/ftthReport");
const smsRoutes = require("./routes/sms");

app.use("/devices", deviceRoutes);
app.use("/upgrade", upgradeRoutes);
app.use("/status", statusRoutes);
app.use("/customers", customerRoutes);
app.use("/iptcustomers", iptCustomerRoutes);
app.use("/sharedcustomers", sharedCustomerRoutes);
app.use("/users", userRoutes);
app.use("/client", clientRoutes);
app.use("/client-db", clientRoutes); // Also mount at /client-db for consistency
app.use("/search", searchRoutes);
app.use("/capacity", capacityRoutes);
app.use("/favorites", favoriteRoutes);
app.use("/uptime-history", uptimeHistoryRoutes);
app.use("/churn-analysis", churnAnalysisRoutes);
app.use("/notifications", notificationRoutes);
app.use("/percentile-reports", require("./routes/percentileReport.js"));
app.use("/provisioning", require("./routes/provisioning.js"));
app.use("/diagnosis", diagnosisRoutes);
app.use("/dia-overusage", diaOverusageRoutes);
app.use('/pitch-for-upgrade', pitchForUpgradeRoutes);
// app.use("/ml", require("./routes/ml.js"));
app.use("/export", exportRoutes);
app.use("/switch-configurations", switchConfigurationRoutes);
app.use("/isis-adjacency", isisAdjacentRoutes);
app.use("/push-token", pushTokenRoutes);
app.use("/l3vpncustomers", l3vpnCustomerRoutes);
app.use("/ftthcustomers", ftthCustomerRoutes);
app.use("/ftth-reports", ftthReportRoutes);
app.use("/sms", smsRoutes);


const { setUserSockets } = require("./emitNotificationToUser");

// Only import cron job functions for manual triggers, do NOT schedule them here
const { updateDIA, updateAggDevices } = require("./cron/updateDIA")(io, { schedule: false });
const { updateIPT, updateAggDevicesIPT } = require("./cron/updateIPT")(io, { schedule: false });
const { updateShared } = require("./cron/updateShared")(io, { schedule: false });
const { cleanupStaleCustomers } = require("./cron/cleanupStaleCustomers")(io, { schedule: false });
const { updateSwitchConfiguration } = require("./cron/switchConfiguration.js")(io, { schedule: false });
const { updateL3VPN } = require("./cron/updateL3VPN.js")(io, { schedule: false });
const { updateFTTHData } = require("./cron/updateFTTH.js")(io, { schedule: false });
const { checkAdjacency } = require("./cron/isisAdjacent")(io, { schedule: false });
const { cleanupStatusHistory } = require("./cron/cleanupStatusHistory")({ schedule: false });
// Remove all schedule*Cron and auto-scheduling here; handled by PM2 forked workers
// Socket for SSH

// Map userId to a set of sockets
const userSockets = new Map();
setUserSockets(userSockets);

io.on("connection", (socket) => {
  console.log("Web client connected");

  // Listen for user registration (client should emit 'register' with userId after connecting)
  socket.on("register", (userId) => {
    if (!userId) return;
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(socket);
    socket.userId = userId;
    console.log(`[Socket] Registered user ${userId}`);
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    if (socket.userId && userSockets.has(socket.userId)) {
      userSockets.get(socket.userId).delete(socket);
      if (userSockets.get(socket.userId).size === 0) {
        userSockets.delete(socket.userId);
      }
    }
  });

  socket.on("connectDevice", async ({ deviceId, username, password }) => {
    // Check if username and password are provided before attempting to connect
    if (!username) {
      return socket.emit("output", "Error: Username not provided.\n");
    }
    if (!password) {
      return socket.emit("output", "Error: Password not provided.\n");
    }

    const device = await Device.findByPk(deviceId);
    if (!device) return socket.emit("output", "Device not found\n");

    const conn = new Client();

    // === Add error/end/close handlers ===
    conn.on("error", (err) => {
      console.error("SSH connection error:", err.message);
      socket.emit("output", "SSH connection error: " + err.message + "\n");
    });

    conn.on("end", () => {
      console.log("SSH connection ended");
      socket.emit("output", "SSH connection ended\n");
    });

    conn.on("close", (hadError) => {
      console.log("SSH connection closed", hadError ? "with error" : "");
      socket.emit("output", "SSH connection closed\n");
    });
    // ===================================

    conn
      .on("ready", () => {
        conn.shell((err, stream) => {
          if (err) return socket.emit("output", "Shell error: " + err.message);

          stream.on("data", (data) => socket.emit("output", data.toString()));
          stream.stderr.on("data", (data) =>
            socket.emit("output", data.toString())
          );

          socket.on("input", (data) => stream.write(data));
          socket.on("disconnect", () => conn.end());
        });
      })
      .connect({
        host: device.ip,
        username, // frontend-provided
        password, // frontend-provided
      });
  });


  // 🎯 NEW: Listener for manual update call
  socket.on("manualDiaUpdate", async () => {
    console.log("========================================");
    console.log("🔥 Received manual 'updateDIA' call from frontend.");
    console.log("========================================");
    // await updateSwitchConfiguration();
    // Execute the update logic
    await updateDIA();
    await updateAggDevices(); 

    await updateIPT();
    await updateAggDevicesIPT();

    await updateShared();

    await updateL3VPN();
    await updateFTTHData();

    await checkAdjacency();
    // 🎯 Notify the client that the update is complete (to enable the button)
    io.emit("diaUpdateComplete"); 
  });

  // Listener for manual shared update
  socket.on("manualSharedUpdate", async () => {
    console.log("========================================");
    console.log("🔥 Received manual 'updateShared' call from frontend.");
    console.log("========================================");

// await updateSwitchConfiguration();
    await updateShared();

    io.emit("sharedUpdateComplete");
  });

  // Listener for manual cleanup of stale customers
  socket.on("manualCleanupStaleCustomers", async () => {
    console.log("========================================");
    console.log("🧹 Received manual 'cleanupStaleCustomers' call from frontend.");
    console.log("========================================");

    await cleanupStaleCustomers();

    io.emit("cleanupComplete");
  });
});


// Only run these scheduled crons in the primary cluster process
if (process.env.NODE_APP_INSTANCE === '0' || process.env.NODE_APP_INSTANCE === undefined) {
  require("./cron/uptimeTracker");
  require("./cron/isisAdjacent")(io);
  const { scheduleDiaOverusageCron } = require("./cron/diaOverusageChecker");
  const { schedulePitchForUpgradeCron } = require("./cron/pitchForUpgradeChecker");
  const { scheduleFTTHDailyCheck } = require("./cron/ftthDailyChecker");
  scheduleDiaOverusageCron();
  schedulePitchForUpgradeCron();
  scheduleFTTHDailyCheck();
}

// Initialize status tracker cache and log summary only in the primary cluster process
const { initializeCache } = require("./utils/statusTracker");
if (process.env.NODE_APP_INSTANCE === '0' || process.env.NODE_APP_INSTANCE === undefined) {
  initializeCache().then((cache) => {
    if (cache) {
      console.log("[StatusTracker] Cache initialized:");
      if (cache.DIA)    console.log(`  - DIA: ${cache.DIA.length} interfaces`);
      if (cache.IPT)    console.log(`  - IPT: ${cache.IPT.length} interfaces`);
      if (cache.SHARED) console.log(`  - SHARED: ${cache.SHARED.length} interfaces`);
      if (cache.L3VPN)  console.log(`  - L3VPN: ${cache.L3VPN.length} interfaces`);
      if (cache.FTTH)   console.log(`  - FTTH: ${cache.FTTH.length} interfaces`);
    }
  });
} else {
  initializeCache();
}



server.listen(4000, async () => {
  console.log("✅ DB connected, backend running at http://localhost:4000");
});
