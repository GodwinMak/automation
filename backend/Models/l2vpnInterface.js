module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "l2vpninterface",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      switchName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      interface: {
        type: DataTypes.STRING, // e.g. ge-0/0/1
        allowNull: false,
      },
      unit: {
        type: DataTypes.STRING, // e.g. 100
        allowNull: false,
      },
      customerName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      adminStatus: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      operationalStatus: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      isHighProfile: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["deviceId", "interface", "unit"],
        },
      ],
    },
  );
};
