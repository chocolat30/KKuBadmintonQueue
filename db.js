const sqlite3 = require('sqlite3').verbose();
const path = require("path");
const dbPath = path.join(__dirname, "queue.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS current_match (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teamA TEXT NOT NULL,
      teamB TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

module.exports = db;
