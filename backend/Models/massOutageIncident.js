module.exports = (sequelize, DataTypes) => {
  const MassOutageIncident = sequelize.define(
    "massOutageIncident",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // NBR-scoped incidents are localized to one shared location/node.
      // GLOBAL-scoped incidents cover simultaneous downs spread across
      // multiple NBRs (e.g. a backbone/core fiber cut).
      scope: {
        type: DataTypes.ENUM("NBR", "GLOBAL"),
        allowNull: false,
      },
      // Populated only for NBR-scoped incidents.
      nbr: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // "resolved" = system detected every member restored on its own.
      // "closed" = an operator manually closed the incident (see closedAt/
      // closedBy/closeComment below) — members left "down" stay that way.
      status: {
        type: DataTypes.ENUM("open", "resolved", "closed"),
        allowNull: false,
        defaultValue: "open",
      },
      // Earliest downSince among the incident's members.
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      // When the threshold was first crossed and the incident was created.
      detectedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      // When the last remaining member was restored (auto-resolve only).
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // When an operator manually closed the incident.
      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      closedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Denormalized display name, kept even if the user is later removed.
      closedByName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Required when closing with members still down — explains why the
      // incident is being closed despite unresolved members.
      closeComment: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Cached counts, kept in sync by the detector so list views avoid joins.
      customerCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      restoredCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // (resolvedAt || closedAt) - startedAt, in seconds. Set once the
      // incident leaves the "open" state.
      totalDurationSeconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "mass_outage_incidents",
      timestamps: true,
      indexes: [
        { fields: ["status"] },
        { fields: ["scope"] },
        { fields: ["nbr"] },
        { fields: ["detectedAt"] },
      ],
    }
  );

  return MassOutageIncident;
};
