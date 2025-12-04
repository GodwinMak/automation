module.exports = (sequelize, DataTypes) => {
  return sequelize.define("client_db", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    area: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    customer_name_pastel: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    customer_other_name_pastel: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    first_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    phone_number: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    email_address: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    new_customer_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    special_comments: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    medium_details: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    revenue_head: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    mbps_seats: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    mbps_network_configuratons: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    network_cid: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    onnet_offnet: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    provider: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });
};
