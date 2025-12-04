module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "percentile_report",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Report type: IPT, DIA, GPON
      reportType: {
        type: DataTypes.ENUM("IPT", "DIA", "GPON"),
        allowNull: false,
      },
      // Month in format YYYY-MM
      month: {
        type: DataTypes.STRING(7),
        allowNull: false,
      },
      // For IPT/DIA: customer ID, for GPON: "GPON"
      customerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customerName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      nbr: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      port: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      switchName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      interface: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      capacity: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      // 95th percentile values (stored in bps for consistency)
      p95Sent: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      p95Recv: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      p95Combined: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      // Display unit used when generating
      displayUnit: {
        type: DataTypes.STRING,
        defaultValue: "bps",
      },
      // Data source: history or trends
      dataSource: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Number of samples used
      samples: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Which switch was actually used (for fallback tracking)
      usedSwitch: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Status: success, error
      status: {
        type: DataTypes.STRING,
        defaultValue: "success",
      },
      errorMessage: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // When the report was generated
      generatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "percentile_reports",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["reportType", "month", "customerId"],
        },
        {
          fields: ["month"],
        },
        {
          fields: ["reportType"],
        },
      ],
    }
  );
};
