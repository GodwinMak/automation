module.exports = (sequelize, DataTypes) => {
  return sequelize.define("favorite", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    customerId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    customerType: {
      type: DataTypes.ENUM("DIA", "IPT", "Shared"),
      allowNull: false,
    },
    interface: {
      type: DataTypes.STRING,
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
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true, // Can be null for global favorites
    },
  });
};

