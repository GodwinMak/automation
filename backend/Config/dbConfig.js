require("dotenv").config();
module.exports = {
  HOST: process.env.DB_HOST,
  USER: process.env.DB_USERNAME,
  PASSWORD: process.env.DB_PASSWORD,
  DB: process.env.DB_NAME,
  dialect: "mysql",

  pool: {
    max: 20,    // raised from 5 — supports concurrent authenticated requests
    min: 2,     // keep a couple warm connections ready
    acquire: 60000, // wait up to 60s before throwing a timeout
    idle: 30000,    // release idle connections after 30s
  },
};