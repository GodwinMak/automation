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
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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
// app.use("/ml", require("./routes/ml.js"));
app.use("/export", exportRoutes);


const { updateDIA, updateAggDevices } = require("./cron/updateDIA")(io);
const { updateIPT, updateAggDevicesIPT } = require("./cron/updateIPT")(io);
const { updateShared } = require("./cron/updateShared")(io);
const { cleanupStaleCustomers } = require("./cron/cleanupStaleCustomers")(io);

// Socket for SSH
io.on("connection", (socket) => {
  console.log("Web client connected");

  socket.on("connectDevice", async ({ deviceId, username, password }) => {
    // Check if username is provided before attempting to connect
    if (!username) {
      return socket.emit("output", "Error: Username not provided.\n");
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
    
    // Execute the update logic
    await updateDIA();
    await updateAggDevices(); 

    await updateIPT();
    await updateAggDevicesIPT();

    await updateShared();
    
    // 🎯 Notify the client that the update is complete (to enable the button)
    io.emit("diaUpdateComplete"); 
  });

  // Listener for manual shared update
  socket.on("manualSharedUpdate", async () => {
    console.log("========================================");
    console.log("🔥 Received manual 'updateShared' call from frontend.");
    console.log("========================================");

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

require("./cron/updateDIA")(io);
require("./cron/updateIPT")(io);
require("./cron/updateShared")(io);
require("./cron/cleanupStaleCustomers")(io);
require("./cron/uptimeTracker");

// Initialize status tracker cache
const { initializeCache } = require("./utils/statusTracker");
initializeCache(); 



const { rescheduleJobs } = require("./Controller/upgrade");
const schedule = require("node-schedule");

server.listen(4000, async () => {
  console.log("✅ DB connected, backend running at http://localhost:4000");
  await rescheduleJobs();
  schedule.scheduleJob("0 0 0,12 * * *", async function () {
    console.log(
      "🚨 Running daily check for temporary upgrade expirations (0000hrs and 1200hrs)..."
    );
    await rescheduleJobs();
    console.log("✅ Daily check complete.");
  });
});
