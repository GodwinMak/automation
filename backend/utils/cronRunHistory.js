/**
 * Persists a record of every cron run withLock() (utils/cronLock.js)
 * actually executes — used to power the process-monitoring page (mean run
 * duration per job, and how often a job had to fall back to running
 * without Redis lock protection). Kept in its own module so cronLock.js
 * doesn't need to know the DB schema, and so a DB write failure here can
 * never affect locking behavior itself.
 */
const db = require("../Models");

/**
 * @param {{ jobName: string, startedAt: Date, finishedAt: Date, durationMs: number, redisFallback: boolean, status: "success"|"error", errorMessage?: string }} run
 */
const recordRun = async (run) => {
  await db.cronJobRuns.create({
    jobName: run.jobName,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    redisFallback: run.redisFallback,
    status: run.status,
    errorMessage: run.errorMessage ? String(run.errorMessage).slice(0, 255) : null,
  });
};

module.exports = { recordRun };
