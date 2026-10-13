module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "l2vpnvplsid",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Denormalized device.name, same pattern as l2vpninterfaces.switchName —
      // avoids a join for the Controller's per-PE vpls-id lookup, which runs
      // on every request.
      switchName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // One VPLS mesh-group's "vpls-id <N>" value off a PE's own config —
      // this equals the virtualCircuitId an access-side l2circuit uses when
      // that circuit actually terminates into this PE's VPLS instance
      // rather than a plain point-to-point l2circuit.
      vplsId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["deviceId", "vplsId"],
        },
      ],
    },
  );
};
