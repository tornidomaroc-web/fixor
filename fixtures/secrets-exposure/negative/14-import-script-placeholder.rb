# ASSUMED-PATH: script/import_scripts/legacy_forum.rb
# script/import_scripts/legacy_forum.rb
# One-off forum importer; operators edit the connection block before running it.
require "mysql2"

DB_HOST = "localhost"
DB_NAME = "legacy_forum"
DB_USER = "root"
password = "change-me-before-import"

client = Mysql2::Client.new(host: DB_HOST, username: DB_USER, password: password, database: DB_NAME)
puts client.query("SELECT COUNT(*) AS n FROM users").first["n"]
