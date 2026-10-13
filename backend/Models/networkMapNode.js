module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "network_map_node",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      mapId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Matches a live devices.name, or one of the synthetic international
      // peer names getWeathermapTopology() adds for neighbors that have no
      // row in `devices` — see Controller/weathermap.js.
      deviceName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      x: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      y: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["mapId", "deviceName"],
        },
      ],
    },
  );
};
