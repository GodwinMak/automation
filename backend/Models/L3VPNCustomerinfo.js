module.exports = (sequelize, DataTypes) => {
  return sequelize.define("l3vpncustomerinfo", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    interface: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: "l3vpncustomers", // table name
        key: "interface",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      unique: true,
    },
    nbr: {
      type: DataTypes.STRING, // switch where customer is found
      allowNull: true,
    },
    port: {
      type: DataTypes.STRING, // ge-0/0/76 or xe-0/0/0 etc.
      allowNull: true,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    cid: {
      type: DataTypes.STRING, // circuit ID
      allowNull: true,
    },
    upmbps: {
      type: DataTypes.INTEGER, // capacity in Mbps
      allowNull: true,
    },
    downmbps: {
      type: DataTypes.INTEGER, // capacity in Mbps
      allowNull: true,
    },
    route_instance:{
      type: DataTypes.STRING,
      allowNull: true,
    }
  });
};

