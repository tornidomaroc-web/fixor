/**
 * Phase 4 real-world validation fixture.
 *
 * Deliberately vulnerable code covering each of Fixor's four detector
 * families. Used ONLY by the open PR that validates Fixor's end-to-end
 * output quality against a live ANTHROPIC_API_KEY.
 *
 * DO NOT MERGE this file. Close the PR once the Fixor scan comment
 * has been captured.
 */

const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ---- 1. SQL injection (CWE-89) --------------------------------------
// Expected: Fixor SqlInjectionDetector -> parameterized rewrite with "?".
app.get("/users/:id", (req, res) => {
  const query =
    "SELECT * FROM users WHERE id = " + req.params.id + " LIMIT 1";
  db.query(query, (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.json(rows);
  });
});

// ---- 2. XSS (CWE-79) -------------------------------------------------
// Expected: Fixor XssDetector -> output encoding / escape or templating.
app.get("/profile", (req, res) => {
  const html =
    "<html><body><h1>Welcome " +
    req.query.name +
    "</h1><p>Bio: " +
    req.query.bio +
    "</p></body></html>";
  res.send(html);
});

// ---- 3. Command injection (CWE-78) ----------------------------------
// Expected: Fixor CommandInjectionDetector -> execFile with argv array.
app.post("/ping", (req, res) => {
  const target = req.body.host;
  exec("ping -c 4 " + target, (err, stdout) => {
    if (err) return res.status(500).send(err.message);
    res.type("text/plain").send(stdout);
  });
});

// ---- 4. Path traversal (CWE-22) -------------------------------------
// Expected: Fixor PathTraversalDetector -> path.resolve + containment check.
const UPLOADS_DIR = "/var/www/uploads";
app.get("/files/:name", (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.name);
  fs.readFile(filePath, (err, data) => {
    if (err) return res.status(404).send("Not found");
    res.end(data);
  });
});

module.exports = app;
