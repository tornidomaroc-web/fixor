const { DataSource } = require("typeorm");
const { User, Document } = require("./models");

const dataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [User, Document],
  synchronize: false,
});

module.exports = { dataSource };
