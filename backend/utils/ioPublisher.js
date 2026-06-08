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

const getClient = () => {
  if (_client) return _connectPromise;

  const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  _client = new Redis(redisUrl, { lazyConnect: true });

  _client.on("error", (err) => {
    const now = Date.now();
    if (now - _lastRedisErrorAt < REDIS_ERROR_LOG_INTERVAL_MS) return;
    _lastRedisErrorAt = now;
    console.error("[ioPublisher] Redis error:", err.message);
  });

  _connectPromise = _client.connect().then(() => {
    console.log("[ioPublisher] Redis publisher connected:", redisUrl);
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
    console.error("[ioPublisher] Failed to publish event:", err.message);
    return false;
  }
};

module.exports = { publish };
