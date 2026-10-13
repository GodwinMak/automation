module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "cronJobRun",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // The lockName passed to utils/cronLock.js's withLock() — e.g.
      // "dia_cron_update", "isis_adjacent_cron" — used as-is as the job
      // identifier so there's no separate name mapping to keep in sync.
      jobName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      finishedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      durationMs: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // True when this run proceeded without lock protection because
      // Redis was unreachable (cronLock.js's failOpen path) — this is
      // specifically the "failed and went to default" event being tracked,
      // not a general job error.
      redisFallback: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      status: {
        type: DataTypes.ENUM("success", "error"),
        allowNull: true,
      },
      errorMessage: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "cron_job_runs",
      timestamps: true,
      indexes: [
        { fields: ["jobName", "startedAt"] },
        { fields: ["jobName", "redisFallback"] },
      ],
    }
  );
};
