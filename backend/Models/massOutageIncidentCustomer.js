module.exports = (sequelize, DataTypes) => {
  const MassOutageIncidentCustomer = sequelize.define(
    "massOutageIncidentCustomer",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      incidentId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      customerType: {
        type: DataTypes.ENUM("DIA", "IPT", "SHARED", "L3VPN", "FTTH"),
        allowNull: false,
      },
      interface: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      switchName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customerName: {
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
      status: {
        type: DataTypes.ENUM("down", "restored"),
        allowNull: false,
        defaultValue: "down",
      },
      downAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      restoredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // restoredAt - downAt, in seconds. Set once restored.
      downtimeSeconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "mass_outage_incident_customers",
      timestamps: true,
      indexes: [
        { fields: ["incidentId"] },
        { fields: ["status"] },
        { fields: ["customerType", "interface"] },
        { unique: true, fields: ["incidentId", "customerType", "interface"], name: "uniq_incident_member" },
      ],
    }
  );

  return MassOutageIncidentCustomer;
};
