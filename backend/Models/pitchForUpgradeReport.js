module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "pitch_for_upgrade_report",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      runAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      customerName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      interfaceName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      upmbps: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      downmbps: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      samplesOver95Upload: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      samplesOver95Download: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      totalUploadSamples: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      totalDownloadSamples: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      pctOver95Upload: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      pctOver95Download: {
        type: DataTypes.FLOAT,
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
      port: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "pitch_for_upgrade_reports",
      timestamps: true,
      indexes: [
        { fields: ["runAt"] },
        { fields: ["interfaceName"] },
      ],
    }
  );
};
