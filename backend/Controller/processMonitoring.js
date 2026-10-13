const db = require("../Models");
const { Op, fn, col, QueryTypes } = require("sequelize");

const CronJobRun = db.cronJobRuns;

// Human-readable labels for the lockName strings used across
// cron/*.js's withLock() calls (utils/cronLock.js) — kept here rather than
// in the cron files themselves so this page's wording can change without
// touching the jobs, and so a job that has never run yet (no rows in
// cron_job_runs) still shows up with zero stats instead of being invisible.
const JOB_LABELS = {
  dia_cron_update: "DIA Sync",
  ipt_cron_update: "IPT Sync",
  shared_cron_update: "Shared Sync",
  l3vpn_cron_update: "L3VPN Sync",
  ftth_cron_update: "FTTH Sync",
  isis_adjacent_cron: "ISIS Adjacency",
  isis_metric_cron: "ISIS Metric",
  isis_stats_cron: "ISIS Traffic Stats",
  isis_ptp_backfill_cron: "ISIS PTP Backfill",
  isis_optics_power_cron: "ISIS Optics Power",
  status_history_cleanup: "Status History Cleanup",
  sms_dlr_checker_cron: "SMS Delivery Report Checker",
  sms_sender_cron: "SMS Sender",
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const startOfWeek = (d) => {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // back up to Monday
  x.setDate(x.getDate() + diff);
  return x;
};
const startOfMonth = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Per-job visibility: mean run duration, total runs, and how many times
 * each job had to fall back to running without Redis lock protection
 * ("failed and went to default"), broken out by today / this week / this
 * month.
 */
exports.getJobStats = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    const durationStats = await CronJobRun.findAll({
      attributes: [
        "jobName",
        [fn("AVG", col("durationMs")), "meanDurationMs"],
        [fn("COUNT", col("id")), "totalRuns"],
      ],
      where: { startedAt: { [Op.gte]: since }, durationMs: { [Op.ne]: null } },
      group: ["jobName"],
      raw: true,
    });
    const statsByJob = new Map(durationStats.map((s) => [s.jobName, s]));

    const fallbackCounts = async (periodStart) => {
      const rows = await CronJobRun.findAll({
        attributes: ["jobName", [fn("COUNT", col("id")), "count"]],
        where: { redisFallback: true, startedAt: { [Op.gte]: periodStart } },
        group: ["jobName"],
        raw: true,
      });
      return new Map(rows.map((r) => [r.jobName, parseInt(r.count, 10)]));
    };

    // Latest row per job, regardless of the `days` window — always want to
    // show the most recent attempt even if it's older than the window.
    const lastRunRows = await db.sequelize.query(
      `
      SELECT t.jobName, t.status, t.startedAt, t.redisFallback, t.errorMessage
      FROM cron_job_runs t
      INNER JOIN (
        SELECT jobName, MAX(startedAt) AS maxStartedAt FROM cron_job_runs GROUP BY jobName
      ) latest ON latest.jobName = t.jobName AND latest.maxStartedAt = t.startedAt
      `,
      { type: QueryTypes.SELECT }
    );
    const lastRunByJob = new Map(lastRunRows.map((r) => [r.jobName, r]));

    const [fallbackToday, fallbackWeek, fallbackMonth] = await Promise.all([
      fallbackCounts(todayStart),
      fallbackCounts(weekStart),
      fallbackCounts(monthStart),
    ]);

    const jobNames = new Set([
      ...Object.keys(JOB_LABELS),
      ...statsByJob.keys(),
      ...lastRunByJob.keys(),
    ]);

    const data = [...jobNames]
      .map((jobName) => {
        const stat = statsByJob.get(jobName);
        const lastRun = lastRunByJob.get(jobName);
        return {
          jobName,
          label: JOB_LABELS[jobName] || jobName,
          meanDurationMs: stat ? Math.round(parseFloat(stat.meanDurationMs)) : null,
          totalRuns: stat ? parseInt(stat.totalRuns, 10) : 0,
          lastRunAt: lastRun ? lastRun.startedAt : null,
          lastRunStatus: lastRun ? lastRun.status : null,
          lastRunWasFallback: lastRun ? !!lastRun.redisFallback : false,
          lastRunError: lastRun ? lastRun.errorMessage : null,
          fallbackCountToday: fallbackToday.get(jobName) || 0,
          fallbackCountThisWeek: fallbackWeek.get(jobName) || 0,
          fallbackCountThisMonth: fallbackMonth.get(jobName) || 0,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    res.json({ windowDays: days, generatedAt: now, data });
  } catch (error) {
    console.error("Error fetching process monitoring stats:", error);
    res.status(500).json({ error: error.message });
  }
};
