const crypto = require("crypto");
const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const REQUEST_CHANNEL = "upgrade:requests";
const RESPONSE_CHANNEL_PREFIX = "upgrade:responses:";

let pubClient;
let subClient;
let pubConnectPromise;
let subConnectPromise;

const ensurePubClient = async () => {
  if (!pubClient) {
    pubClient = new Redis(REDIS_URL, { lazyConnect: true });
    pubClient.on("error", (err) => {
      console.error("[UpgradeRPC] Publisher Redis error:", err.message);
    });
    pubConnectPromise = pubClient.connect();
  }
  await pubConnectPromise;
  return pubClient;
};

const ensureSubClient = async () => {
  if (!subClient) {
    subClient = new Redis(REDIS_URL, { lazyConnect: true });
    subClient.on("error", (err) => {
      console.error("[UpgradeRPC] Subscriber Redis error:", err.message);
    });
    subConnectPromise = subClient.connect();
  }
  await subConnectPromise;
  return subClient;
};

const callUpgradeWorker = async (service, body, timeoutMs = 300000) => {
  const requestId = crypto.randomUUID();
  const responseChannel = `${RESPONSE_CHANNEL_PREFIX}${requestId}`;

  const publisher = await ensurePubClient();
  const subscriber = await ensureSubClient();

  return new Promise(async (resolve, reject) => {
    let timeoutId;

    const cleanup = async () => {
      if (timeoutId) clearTimeout(timeoutId);
      try {
        await subscriber.unsubscribe(responseChannel);
      } catch (_err) {
        // Ignore unsubscribe errors; request is already finishing.
      }
      subscriber.off("message", onMessage);
    };

    const onMessage = async (channel, message) => {
      if (channel !== responseChannel) return;

      try {
        const payload = JSON.parse(message);
        await cleanup();
        resolve(payload);
      } catch (error) {
        await cleanup();
        reject(error);
      }
    };

    try {
      subscriber.on("message", onMessage);
      await subscriber.subscribe(responseChannel);

      await publisher.publish(
        REQUEST_CHANNEL,
        JSON.stringify({ requestId, service, body })
      );

      timeoutId = setTimeout(async () => {
        await cleanup();
        reject(new Error("Upgrade worker timeout"));
      }, timeoutMs);
    } catch (error) {
      await cleanup();
      reject(error);
    }
  });
};

const executeController = async (controller, body) =>
  new Promise((resolve) => {
    let completed = false;

    const finalize = (status, payload) => {
      if (completed) return;
      completed = true;
      resolve({ status, body: payload });
    };

    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        finalize(this.statusCode || 200, payload);
      },
      send(payload) {
        finalize(this.statusCode || 200, payload);
      },
    };

    Promise.resolve(controller({ body }, res)).catch((error) => {
      console.error("[UpgradeRPC] Controller execution error:", error.message || error);
      finalize(500, { message: "Internal server error" });
    });
  });

const startUpgradeWorkerRpcServer = async (handlers) => {
  const subscriber = new Redis(REDIS_URL, { lazyConnect: true });
  const publisher = subscriber.duplicate();

  subscriber.on("error", (err) => {
    console.error("[UpgradeRPC] Worker subscriber error:", err.message);
  });
  publisher.on("error", (err) => {
    console.error("[UpgradeRPC] Worker publisher error:", err.message);
  });

  await Promise.all([subscriber.connect(), publisher.connect()]);

  subscriber.on("message", async (_channel, message) => {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch (error) {
      console.error("[UpgradeRPC] Invalid request payload:", error.message);
      return;
    }

    const { requestId, service, body } = parsed;
    if (!requestId || !service) return;

    const responseChannel = `${RESPONSE_CHANNEL_PREFIX}${requestId}`;
    const handler = handlers[service];

    if (!handler) {
      await publisher.publish(
        responseChannel,
        JSON.stringify({ status: 400, body: { message: "Unknown upgrade service" } })
      );
      return;
    }

    try {
      const result = await executeController(handler, body || {});
      await publisher.publish(responseChannel, JSON.stringify(result));
    } catch (error) {
      console.error("[UpgradeRPC] Worker handler error:", error.message || error);
      await publisher.publish(
        responseChannel,
        JSON.stringify({ status: 500, body: { message: "Internal server error" } })
      );
    }
  });

  await subscriber.subscribe(REQUEST_CHANNEL);
  console.log("[UpgradeRPC] Worker listening on", REQUEST_CHANNEL);
};

module.exports = {
  callUpgradeWorker,
  startUpgradeWorkerRpcServer,
};