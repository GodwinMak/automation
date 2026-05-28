/**
 * smsCampaign – stores one record per bulk SMS broadcast.
 * chunks: array of { requestId: string, numbers: string[] }
 *   – each chunk maps a Beem request_id to the phone numbers it covered.
 *   – used later to query the DLR API per recipient.
 */
module.exports = (sequelize, DataTypes) => {
  return sequelize.define("smsCampaign", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    customerType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // [{ requestId: "12345", numbers: ["255700000001", ...] }]
    chunks: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    totalSent: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    customerCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    extraCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  });
};
