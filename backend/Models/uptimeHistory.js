module.exports = (sequelize, DataTypes) => {
  return sequelize.define("uptimehistory", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    hour: {
      type: DataTypes.INTEGER,
      allowNull: true, // null for daily summary
    },
    customerType: {
      type: DataTypes.ENUM("DIA", "IPT", "Shared", "ALL"),
      allowNull: false,
    },
    totalCustomers: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    upCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    downCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    uptimePercentage: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    totalCapacity: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    upCapacity: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    downCapacity: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
  }, {
    indexes: [
      {
        unique: true,
        fields: ['date', 'hour', 'customerType'],
      },
    ],
  });
};

