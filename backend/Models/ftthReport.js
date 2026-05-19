module.exports = (sequelize, DataTypes) => {
  return sequelize.define("ftthReport", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    reportDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      unique: true,
    },
    filePath: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    totalExpiredChecked: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    aliveWhileExpiredCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    notInInfoCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  });
};
