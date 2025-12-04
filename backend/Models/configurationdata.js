module.exports = (sequelize, DataTypes) => {
  return sequelize.define("configurationdata", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    bng_pe_configurations: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    nbr_switch_configurations: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    customerinfo_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      references: {
        model: "customerinfos",
        key: "id",
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        unique: true,
      },
      allowNull: false,
    },
  });
};
