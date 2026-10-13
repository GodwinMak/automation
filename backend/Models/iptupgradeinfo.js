module.exports = (sequelize, DataTypes) => {
  return sequelize.define("iptupgradeinfo", {
    id:{
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    interface: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: "iptcustomerinfos", // table name
        key: "interface",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    account_manager:{
        type: DataTypes.STRING,
        allowNull: false,
    },
    current_bandwidth:{
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    upgrade_bandwidth:{
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    downgrade_bandwidth:{
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    approved_by:{
        type: DataTypes.STRING,
        allowNull: false,
    },
    start_date:{
        type: DataTypes.DATE,
        allowNull: true,
    },
    end_date:{
        type: DataTypes.DATE,
        allowNull: true,
    },
    downgrade_date:{
        type: DataTypes.DATE,
        allowNull: true,
    },
    done_by:{
      type: DataTypes.STRING,
      allowNull: false
    }
  });
};
