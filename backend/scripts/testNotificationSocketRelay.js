/**
 * Diagnostic: does a Redis-published "linkDownAlert" actually reach a
 * connected Socket.IO client, and exactly once?
 *
 * Full chain being tested (see utils/ioPublisher.js, server.js,
 * emitNotificationToUser.js, and NotificationBell.tsx's socket listener):
 *
 *   1. A cron worker (fork process, no local sockets) calls
 *      ioPublisher.publish("linkDownAlert", payload) — this PUBLISHes a
 *      JSON-encoded { event, payload } to the Redis channel
 *      "socket.io:worker-events".
 *   2. EVERY automation-server cluster instance independently SUBSCRIBEs to
 *      that same channel (server.js ~line 60-71) and, on message, calls its
 *      own local io.emit(event, payload).
 *   3. Because io.adapter() wraps every instance's io in the
 *      @socket.io/redis-adapter, that io.emit() is itself cluster-wide —
 *      it reaches sockets connected to ANY instance, not just the one that
 *      received the pub/sub message.
 *
 * That combination is suspect: if N cluster instances are all subscribed to
 * the same channel, a single publish could fan out through N independent
 * cluster-wide emits, meaning every connected client (browser tab) would
 * receive the SAME event N times — which would show up as the notification
 * sound firing N times per real alert, or the unread badge jumping by N
 * instead of 1 (see NotificationBell.tsx's "linkDownAlert" handler, which
 * does unconditional prev+1 and playNotificationSound() on every receipt,
 * with no de-duplication).
 *
 * This script connects one real Socket.IO client (mirroring
 * NotificationBell.tsx's exact transport config), publishes ONE synthetic
 * event directly to the Redis channel (bypassing cron workers entirely so
 * only the relay itself is under test), and reports how many times — and
 * how fast — the client actually received it.
 *
 * Usage (from backend/):
 *   node scripts/testNotificationSocketRelay.js
 *   node scripts/testNotificationSocketRelay.js --url http://localhost:4000 --timeout 8000
 *
 * Run this ON the production box (not your dev machine) to exercise the
 * real PM2 cluster — a single-instance dev server can't reproduce a
 * multi-subscriber fan-out bug.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { io: ioClient } = require("socket.io-client");
const Redis = require("ioredis");

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const SERVER_URL = getArg("url", "http://localhost:4000");
const TIMEOUT_MS = Number(getArg("timeout", 8000));
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const CHANNEL = "socket.io:worker-events";

const run = async () => {
  console.log(`[test] Connecting Socket.IO client to ${SERVER_URL} ...`);

  const socket = ioClient(SERVER_URL, {
    transports: ["websocket"],
    upgrade: false,
  });

  const receivedAt = [];
  let publishedAt = null;

  socket.on("connect", () => {
    console.log(`[test] Connected (socket id: ${socket.id})`);
  });

  socket.on("connect_error", (err) => {
    console.error(`[test] Connection error: ${err.message}`);
  });

  socket.on("linkDownAlert", (payload) => {
    const t = Date.now();
    receivedAt.push(t);
    const latency = publishedAt !== null ? `+${t - publishedAt}ms` : "before our publish (unrelated event)";
    console.log(
      `[test] Received linkDownAlert #${receivedAt.length} at ${latency}` +
        (payload?.notificationType === "diagnostic_test" ? " (our test payload)" : " (WARNING: not our test payload — a real alert fired during this test)")
    );
  });

  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("Timed out waiting to connect")), 10000);
  });

  console.log(`[test] Publishing test event to Redis channel "${CHANNEL}" ...`);
  const redis = new Redis(REDIS_URL);
  const testPayload = {
    customerId: null,
    customerName: "DIAGNOSTIC TEST — ignore",
    customerType: "TEST",
    interface: "test0",
    cid: "N/A",
    nbr: "N/A",
    previousStatus: "up",
    currentStatus: "down",
    switchName: null,
    notificationType: "diagnostic_test",
    message: "🧪 This is a diagnostic test event from testNotificationSocketRelay.js — safe to ignore.",
    timestamp: new Date().toISOString(),
  };

  publishedAt = Date.now();
  await redis.publish(CHANNEL, JSON.stringify({ event: "linkDownAlert", payload: testPayload }));
  console.log(`[test] Published. Waiting up to ${TIMEOUT_MS}ms for delivery...`);

  await new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS));

  console.log("\n=== RESULT ===");
  console.log(`Received ${receivedAt.length} time(s).`);
  if (receivedAt.length === 0) {
    console.log(
      "❌ Never arrived. Check: is the Redis adapter connected on this instance " +
        '("[Socket.IO] Redis adapter connected" in the automation-server logs)? ' +
        'Is the worker-events subscription active ("Subscribed to worker-events channel")? ' +
        "Does this process's REDIS_URL match the one cron workers publish to?"
    );
  } else if (receivedAt.length === 1) {
    console.log(`✅ Delivered exactly once, ${receivedAt[0] - publishedAt}ms after publish. Relay is healthy.`);
  } else {
    console.log(
      `⚠️  Delivered ${receivedAt.length} times for a single publish — this matches the suspected bug: ` +
        "every automation-server cluster instance subscribes to the same Redis channel independently, " +
        "and (via the redis-adapter) each one's io.emit() is already cluster-wide, so N instances " +
        "subscribed = N deliveries per client. This is very likely why the notification sound " +
        `fires multiple times per real alert. Instance count should match PM2's cluster size (pm2 status "automation-server").`
    );
  }

  socket.disconnect();
  redis.disconnect();
  process.exit(receivedAt.length === 1 ? 0 : 1);
};

run().catch((err) => {
  console.error("[test] Failed:", err.message);
  process.exit(1);
});
