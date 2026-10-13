/**
 * smsCampaign – stores one record per bulk SMS broadcast.
 * chunks: array of { requestId: string, numbers: string[] }
 *   – each chunk maps a Beem request_id to the phone numbers it covered.
 *   – used later to query the DLR API per recipient.
 * recipients: identity-carrying recipient list captured at request time
 *   (POST /sms/send), so the background sender (cron/smsSender.js) doesn't
 *   need to re-derive "all FTTH customers" etc. from live data — it sends
 *   to the exact snapshot the user saw/confirmed.
 * status: queued -> sending -> completed | failed. Set to "queued" by the
 *   request handler; the rest is driven entirely by cron/smsSender.js.
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
    // [{ customerId, customerName, customerType, phoneNumber }]
    recipients: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    // [{ requestId: "12345", numbers: ["255700000001", ...] }]
    chunks: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    status: {
      type: DataTypes.ENUM("queued", "sending", "completed", "failed"),
      allowNull: false,
      defaultValue: "queued",
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
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
