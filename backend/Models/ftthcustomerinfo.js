/**
 * ftthcustomerinfo – stores rows parsed from Active-ChurnRetailReport.xlsx.
 * customerID is the join key back to ftthcustomer.customerID.
 * Only rows whose customerID already exists in ftthcustomer are inserted.
 */
module.exports = (sequelize, DataTypes) => {
  return sequelize.define("ftthcustomerinfo", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Must match a customerID value that exists in ftthcustomer
    customerID: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    emailAddress: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    homeNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    topUpExpiry: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    validityPeriod: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });
};
