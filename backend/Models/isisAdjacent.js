module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "isis_adjacency",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      local_device_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      neighbor_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      interface: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      raw_interface: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      point_to_point_ip: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      metric: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      port_speed: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      input_bps: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      output_bps: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      level: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      state: {
        type: DataTypes.ENUM("Up", "Down"),
        allowNull: false,
      },
      last_seen: {
        type: DataTypes.DATE,
      },
      last_checked: {
        type: DataTypes.DATE,
      },
      // --- New alert tracking fields ---
      last_down_alert_sent: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_up_alert_sent: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_high_traffic_alert: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // --- Optics power monitoring fields ---
      // Stored as JSON-stringified arrays of dBm readings so that both
      // single-lane ports (ge/xe) and 4-lane ports (et- 40G/100G) fit the
      // same column, e.g. "[-0.07]" vs "[-0.32,-0.96,-0.99,-1.85]".
      // Radio-backed links have no optics, so these stay null for them.
      tx_power_dbm: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      rx_power_dbm: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      tx_high_alarm_dbm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      tx_low_alarm_dbm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      tx_high_warning_dbm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      tx_low_warning_dbm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      rx_high_alarm_dbm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      rx_low_alarm_dbm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      rx_high_warning_dbm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      rx_low_warning_dbm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      last_power_checked: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["local_device_id", "neighbor_name", "raw_interface"],
        },
      ],
    },
  );
};