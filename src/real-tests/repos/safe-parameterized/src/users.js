const mysql = require("mysql2");

function getUser(connection, userId) {
  return connection.query("SELECT * FROM users WHERE id = ?", [userId]);
}

module.exports = { getUser };
