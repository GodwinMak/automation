module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "dia_overusage_report",
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
      maxUploadBps: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      maxDownloadBps: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      maxUpload: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      maxDownload: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      overUploadSamples: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      overDownloadSamples: {
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
      tableName: "dia_overusage_reports",
      timestamps: true,
      indexes: [
        {
          fields: ["runAt"],
        },
        {
          fields: ["interfaceName"],
        },
      ],
    }
  );
};
