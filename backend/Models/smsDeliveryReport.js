/**
 * smsDeliveryReport – one row per recipient of an smsCampaign.
 * Populated as "pending" at send time, then filled in by the
 * cron/smsDeliveryReportChecker.js background job, which polls Beem's DLR
 * API and writes the resolved status back here. The delivery-report/full
 * endpoint reads straight from this table so the report shows instantly
 * instead of live-querying Beem on every request.
 */
module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "smsDeliveryReport",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      campaignId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      customerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customerName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customerType: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phoneNumber: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      requestId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("pending", "delivered", "not_delivered", "unknown"),
        allowNull: false,
        defaultValue: "pending",
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastCheckedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "sms_delivery_reports",
      timestamps: true,
      indexes: [
        { fields: ["campaignId"] },
        { fields: ["status"] },
        { fields: ["campaignId", "status"] },
      ],
    }
  );
};
