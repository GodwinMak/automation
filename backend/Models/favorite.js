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
      type: DataTypes.ENUM("DIA", "IPT", "Shared", "L3VPN", "FTTH", "L2VPN"),
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
    // Whether this watch-listed customer should also trigger an SMS (in
    // addition to the always-on in-app notification) when it goes down or
    // recovers. Defaults true so existing favorites start getting SMS as
    // soon as this feature ships.
    smsAlertsEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  });
};

