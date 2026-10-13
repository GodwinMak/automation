module.exports = (sequelize, DataTypes) => {
  return sequelize.define("l2vpndeviceskip", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    deviceId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: "devices", // table name
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    // Last time this device was polled and found to have no L2VPN
    // customers — used to skip it for the next 6 hours.
    lastNoDataAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });
};
