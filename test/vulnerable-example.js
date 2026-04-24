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
{
  "name": "context-ops-mcp",
  "version": "1.0.0",
  "description": "Revenue diagnosis MCP tool — analyzes SaaS codebases for billing gaps, onboarding friction, and competitive readiness",
  "main": "dist/index.js",
  "bin": {
    "context-ops-mcp": "dist/index.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
]
  "author": "AboJad",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/tornidomaroc-web/context-ops-mcp.git"
{
  "dependencies": {
    "@prisma/client": "^6.19.2",
    "zod": "^4.3.6"
  },
}
