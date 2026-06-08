module.exports = (sequelize, DataTypes) => {
  const StatusChangeHistoryFtth = sequelize.define(
    "statusChangeHistoryFtth",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      customerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customerType: {
        type: DataTypes.ENUM("DIA", "IPT", "SHARED", "L3VPN", "FTTH"),
        allowNull: false,
      },
      interface: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      switchName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customerName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      cid: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      nbr: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      previousStatus: {
        type: DataTypes.ENUM("up", "down", "unknown"),
        allowNull: false,
      },
      newStatus: {
        type: DataTypes.ENUM("up", "down", "unknown"),
        allowNull: false,
      },
      durationInPreviousState: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      changedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "statusChangeHistories_ftth",
      timestamps: true,
      indexes: [
        { fields: ["interface"] },
        { fields: ["customerType"] },
        { fields: ["changedAt"] },
        { fields: ["previousStatus", "newStatus"] },
        { fields: ["customerName"] },
        { fields: ["nbr"] },
        { name: "idx_sch_ftth_type_iface_at", fields: ["customerType", "interface", "changedAt"] },
      ],
    }
  );

  return StatusChangeHistoryFtth;
};
