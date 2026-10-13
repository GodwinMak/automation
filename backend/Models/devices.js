module.exports = (sequelize, DataTypes) =>{
    return Devices = sequelize.define("device", {
        id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      ip: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      lat:{
        type: DataTypes.DECIMAL(10, 6),
        allowNull: true
      },
      long:{
        type: DataTypes.DECIMAL(10, 6),
        allowNull: true
      },
      // Set by fiberCutDetector.checkDeviceIsolation() when every ISIS
      // adjacency touching this device (its own + neighbor-reported) is
      // Down — i.e. it has no working path to the rest of the network.
      isIsolated: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      isolatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      }
    })
}