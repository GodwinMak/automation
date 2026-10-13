/**
 * ioPublisher.js
 *
 * Used by cron worker processes (fork mode) to publish Socket.IO events
 * through Redis so every server cluster instance broadcasts them to clients.
 *
 * This is the correct cross-process alternative to emitting on a local `io`
 * object that has no connected sockets in fork workers.
 */

const Redis = require("ioredis");

let _client = null;
let _connectPromise = null;
let _lastRedisErrorAt = 0;
const REDIS_ERROR_LOG_INTERVAL_MS = 30000;
const PUBLISH_RETRY_DELAY_MS = 500;

const resetClient = () => {
  if (_client) {
    try {
      _client.disconnect();
    } catch (_err) {
      // Ignore disconnect errors during reset.
    }
  }
  _client = null;
  _connectPromise = null;
};

const getClient = () => {
  if (_client && _connectPromise) return _connectPromise;

  const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  _client = new Redis(redisUrl, { lazyConnect: true });

  _client.on("error", (err) => {
    const now = Date.now();
    if (now - _lastRedisErrorAt < REDIS_ERROR_LOG_INTERVAL_MS) return;
    _lastRedisErrorAt = now;
    console.error("[ioPublisher] Redis error:", err.message);
  });

  _connectPromise = _client
    .connect()
    .then(() => {
      console.log("[ioPublisher] Redis publisher connected:", redisUrl);
      return _client;
    })
    .catch((err) => {
      // Important: clear cached failed promise/client so next publish can retry.
      resetClient();
      throw err;
    });

  return _connectPromise;
};

/**
 * Publish a Socket.IO event to all server instances via Redis pub/sub.
 *
 * @param {string} event  - Socket.IO event name (e.g. "linkDownAlert")
 * @param {object} payload - JSON-serialisable event payload
 */
const publish = async (event, payload) => {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await getClient();

      // The @socket.io/redis-adapter subscribes to "socket.io#<namespace>#" channel.
      // Encoding: [uid, event, args] where uid is the nsp-unique ID.
      // Easiest correct approach: encode as the adapter expects via msgpack-lite
      // OR use the simpler "emit" channel that the adapter also supports.
      //
      // Because importing the adapter's internal encoder is fragile across versions,
      // we use a clean approach: publish to a custom Redis channel and have the server
      // subscribe to it (handled in server.js subscribeToWorkerEvents).
      await _client.publish("socket.io:worker-events", JSON.stringify({ event, payload }));
      return true;
    } catch (err) {
      lastError = err;
      resetClient();
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, PUBLISH_RETRY_DELAY_MS));
      }
    }
  }

  console.error("[ioPublisher] Failed to publish event:", lastError?.message || "unknown error");
  return false;
};

module.exports = { publish };
