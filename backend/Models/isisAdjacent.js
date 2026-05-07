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