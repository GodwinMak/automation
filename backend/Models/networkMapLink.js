module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "network_map_link",
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
      sourceDeviceName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      targetDeviceName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Disambiguates parallel physical links between the same device pair
      // (e.g. two separate links between LTZ-ACC1-420 and LTZ-ACC2-420) —
      // matches the interface identity getWeathermapTopology()'s edges
      // carry, so each parallel link can be its own row.
      sourceInterface: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      targetInterface: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Manual override for the line-width calculation — when set, drawn
      // instead of the live-polled portSpeedMbps (Controller/weathermap.js),
      // so an admin can represent a link's capacity even when live discovery
      // hasn't populated port_speed yet, or wants a different value shown.
      capacityMbps: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Single bend/control point for rendering this link as a curve
      // instead of a straight line (quadratic Bezier through this point).
      // Null on both means "straight line" — the default.
      bendX: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      bendY: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          name: "uq_map_link",
          unique: true,
          fields: ["mapId", "sourceDeviceName", "targetDeviceName", "sourceInterface"],
        },
      ],
    },
  );
};
