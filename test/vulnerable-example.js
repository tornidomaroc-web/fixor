const mysql = require('mysql');
const express = require('express');
const app = express();

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  database: 'testdb'
});

app.get('/user', (req, res) => {
  const userId = req.query.id;
  const query = `SELECT * FROM users WHERE id = ${userId}`;
  
  connection.query(query, (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

app.get('/search', (req, res) => {
  const name = req.query.name;
  const sql = "SELECT * FROM products WHERE name = '" + name + "'";
  
  connection.query(sql, (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

app.listen(3000);

{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false
  }
}
