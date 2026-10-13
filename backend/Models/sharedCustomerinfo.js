module.exports = (sequelize, DataTypes) => {
  return sequelize.define("sharedcustomerinfo", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    interface: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: "sharedcustomers", // table name
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
    capacity: {
      type: DataTypes.INTEGER, // capacity in Mbps
      allowNull: true,
    },
    isHighProfile: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  });
};

