module.exports = (sequelize, DataTypes) => {
  return sequelize.define("l2vpncircuit", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    l2vpnInterfaceId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: "l2vpninterfaces", // table name
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    virtualCircuitId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    vlanId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    inputMbps: {
      type: DataTypes.INTEGER, // capacity in Mbps
      allowNull: true,
    },
    outputMbps: {
      type: DataTypes.INTEGER, // capacity in Mbps
      allowNull: true,
    },
    // The l2circuit neighbor IP resolved against devices.ip -> devices.name;
    // if no device in the table has that IP, this just holds the raw IP.
    neighbor: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Junos protection circuits carry a "backup-neighbor <ip>" alongside
    // the primary — same IP-to-device-name resolution as `neighbor`. Some
    // circuits only chain correctly through this field (the primary
    // neighbor points at a device that isn't actually configured with this
    // vcid at all — see LTZ-ACC1-AMV/LTZ-ACC1-RAH, vcid 2554900405, where
    // the real far end only shows up via AMV's backup-neighbor).
    backupNeighbor: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });
};
