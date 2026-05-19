module.exports = (sequelize, DataTypes) => {
  return sequelize.define("ftthcustomer", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    pppoeusername: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    ip_version: {
      type: DataTypes.ENUM("IPv4", "IPv6"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("up", "down"),
      allowNull: false,
      defaultValue: "up",
    },
    customerID: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // --- Fields synced from Active-ChurnRetailReport Excel ---
    homeNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    topUpExpiry: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // --- Flag columns ---
    // True when topUpExpiry is in the past
    isExpired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // True when the customer was pinged alive AFTER expiry (needs CR verification)
    isAliveWhileExpired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Set by CR after verifying the customer is a free-service customer; stops daily pinging
    isFreeCustomer: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // True when this record exists in ftthcustomer but has no matching row in ftthcustomerinfo
    notInInfo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Timestamp of the most recent ping attempt for this record
    lastPingedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });
};