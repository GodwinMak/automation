module.exports = (sequelize, DataTypes) => {
  return SwitchConfiguration = sequelize.define("switchConfiguration", {
    id: {
      type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    deviceId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    deviceName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    filePath: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  });
}