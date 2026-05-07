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
      }
    })
}