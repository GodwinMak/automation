module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "isis_watchlist",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // The actual matching key used at alert time (see
      // utils/notificationRecipients.js) — isis_adjacency rows churn as
      // links flap, point_to_point_ip is the stable identity of a physical
      // link end used elsewhere in the codebase (Controller/isisAdjacent.js
      // ptpNetworkKey).
      pointToPointIp: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Soft reference for convenience/debugging only — not used to resolve
      // alert recipients, since the adjacency row this pointed at may have
      // been replaced by the time an alert fires.
      isisAdjacencyId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Denormalized display fields so the watch list survives adjacency
      // row churn/deletion without a join at render time.
      neighborName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      interfaceName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      deviceName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["userId", "pointToPointIp"],
        },
      ],
    }
  );
};
