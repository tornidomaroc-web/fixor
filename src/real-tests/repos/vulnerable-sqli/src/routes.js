const mysql = require("mysql2");

function getUser(connection, userId) {
  const sql = "SELECT * FROM users WHERE id = " + userId;
  return connection.query(sql);
}

module.exports = { getUser };
