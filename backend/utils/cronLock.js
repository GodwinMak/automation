/**
 * cronLock.js
 *
 * Cross-process "only one runner at a time" guard for cron jobs, backed by
 * Redis instead of MySQL's GET_LOCK()/RELEASE_LOCK().
 *
 * GET_LOCK/RELEASE_LOCK are session-scoped in MySQL, but Sequelize's pooled
 * connections don't guarantee the release query runs on the same physical
 * connection that acquired the lock — when it lands on a different one,
 * MySQL refuses to release it (only the owning session can), and the lock
 * stays held by an idle-but-still-open connection indefinitely. Every
 * future GET_LOCK(..., 0) then fails silently and the cron just stops
 * running with no error anywhere (this is exactly what happened to
 * ipt_cron_update — stuck on a dead connection with no scheduled tick
 * running for 12+ minutes). A plain GET_LOCK is also unbounded: if the
 * holder is killed abruptly (OOM, crash) without closing its connection
 * promptly, the lock can stay stuck until MySQL's wait_timeout reaps it,
 * which defaults to hours.
 *
 * A Redis SET ... NX is a single atomic command, so there's no
 * acquire/release connection-pairing to get wrong, and giving it a TTL
 * means even a crashed holder self-clears instead of blocking forever.
 */

const Redis = require("ioredis");
const { recordRun } = require("./cronRunHistory");

let _client = null;

const getClient = () => {
  if (!_client) {
    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    _client = new Redis(redisUrl);
    _client.on("error", (err) => {
      console.error("[cronLock] Redis error:", err.message);
    });
  }
  return _client;
};

// Comfortably longer than any real cron run so a slow-but-alive run is
// never preempted, while still bounding how long a crashed holder's lock
// can block everyone else.
const LOCK_TTL_MS = 10 * 60 * 1000;

// Lua script so the release is atomic: only delete the key if it still
// holds OUR token — otherwise we might delete a lock some later run
// acquired after our TTL already expired mid-run.
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/**
 * Run `fn` only if no other runner currently holds `lockName` anywhere
 * (any process, any host). If the lock is already held, logs (when
 * LOG_LOCK_SKIPS=1) and returns without calling `fn` — same behavior the
 * GET_LOCK(..., 0) call sites had.
 *
 * If Redis itself can't be reached, that's a different situation from the
 * lock being held — it means we simply don't know the lock state, not that
 * someone else has it. Two ways to handle that, per job:
 *
 *   failOpen: true  (default) — run `fn` anyway, unprotected. Redis wasn't
 *     previously a dependency for these crons at all; a brief outage
 *     shouldn't stop an idempotent upsert (bulkCreate/updateOnDuplicate)
 *     from running. Worst case on a genuine overlap is redundant work, not
 *     wrong data.
 *
 *   failOpen: false — skip the tick, same as a real lock conflict. Use
 *     this where an unprotected overlap would actually cause harm — e.g.
 *     cron/smsSender.js, where two runners picking up the same queued
 *     campaign at once would double-send it to every recipient.
 */
const withLock = async (lockName, fn, { failOpen = true } = {}) => {
  const client = getClient();
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;

  let acquired;
  let redisReachable = true;
  try {
    acquired = await client.set(lockName, token, "PX", LOCK_TTL_MS, "NX");
  } catch (err) {
    redisReachable = false;
    if (!failOpen) {
      console.error(`[cronLock] Redis unavailable, skipping this tick for ${lockName}:`, err.message);
      return;
    }
    console.warn(`[cronLock] Redis unavailable for ${lockName}, proceeding without lock protection:`, err.message);
  }

  if (redisReachable && !acquired) {
    if (process.env.LOG_LOCK_SKIPS === "1") {
      console.warn(`[cronLock] ${lockName} already running elsewhere — skipping this tick.`);
    }
    return;
  }

  const startedAt = new Date();
  let runError = null;
  try {
    await fn();
  } catch (err) {
    runError = err;
    throw err;
  } finally {
    const finishedAt = new Date();
    try {
      await recordRun({
        jobName: lockName,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        redisFallback: !redisReachable,
        status: runError ? "error" : "success",
        errorMessage: runError?.message,
      });
    } catch (recErr) {
      console.error(`[cronLock] Failed to record run history for ${lockName}:`, recErr.message);
    }

    // Nothing to release if Redis was unreachable at acquire time — we
    // never actually held a lock, just ran fn() unprotected.
    if (redisReachable) {
      try {
        await client.eval(RELEASE_SCRIPT, 1, lockName, token);
      } catch (err) {
        console.error(`[cronLock] Failed to release ${lockName} (will self-expire in ${LOCK_TTL_MS / 1000}s):`, err.message);
      }
    }
  }
};

module.exports = { withLock };
