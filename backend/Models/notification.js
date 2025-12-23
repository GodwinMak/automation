module.exports = (sequelize, DataTypes) => {
  return sequelize.define("notification", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
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
    previousStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "up",
    },
    currentStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "down",
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    notificationType: {
      type: DataTypes.ENUM("status_change", "alert", "info"),
      defaultValue: "status_change",
    },
  });
};

