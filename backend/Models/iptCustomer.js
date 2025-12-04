module.exports = (sequelize, DataTypes) => {
  return (DIACustomer = sequelize.define("iptcustomer", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    interface: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    switchName: {
      type: DataTypes.STRING,
      allowNull: true, // optional, can make false if always required
    },
    adminStatus: {
      type: DataTypes.ENUM("up", "down"),
      defaultValue: "down",
    },
    operationalStatus:{
        type: DataTypes.ENUM("up", "down"),
        defaultValue: "down",
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    destination: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  }));
};
