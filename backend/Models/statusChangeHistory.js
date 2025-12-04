module.exports = (sequelize, DataTypes) => {
  const StatusChangeHistory = sequelize.define(
    "statusChangeHistory",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Reference to the customer
      customerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Customer type: DIA, IPT, SHARED
      customerType: {
        type: DataTypes.ENUM("DIA", "IPT", "SHARED"),
        allowNull: false,
      },
      // Interface identifier
      interface: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Switch name
      switchName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Customer name for easy reference
      customerName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // CID for reference
      cid: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // NBR location
      nbr: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Previous status before change
      previousStatus: {
        type: DataTypes.ENUM("up", "down", "unknown"),
        allowNull: false,
      },
      // New status after change
      newStatus: {
        type: DataTypes.ENUM("up", "down", "unknown"),
        allowNull: false,
      },
      // Duration in the previous state (in seconds)
      durationInPreviousState: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      // Timestamp when the status changed
      changedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      // Additional notes or metadata
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "statusChangeHistories",
      timestamps: true,
      indexes: [
        { fields: ["interface"] },
        { fields: ["customerType"] },
        { fields: ["changedAt"] },
        { fields: ["previousStatus", "newStatus"] },
        { fields: ["customerName"] },
        { fields: ["nbr"] },
      ],
    }
  );

  return StatusChangeHistory;
};

