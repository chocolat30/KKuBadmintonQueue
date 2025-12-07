const sqlite3 = require('sqlite3').verbose();
const path = require("path");
const dbPath = path.join(__dirname, "queue.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {

  // ========== TABLE: queue ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      matchesPlayed INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      timestamp INTEGER DEFAULT (strftime('%s','now')*1000)
    )
  `);

  // Ensure matchesPlayed column exists
  db.get("PRAGMA table_info(queue)", (err, info) => {
    if (err) return;
    const columns = [];
    db.all("PRAGMA table_info(queue)", (err, rows) => {
      if (err) return;
      rows.forEach(r => columns.push(r.name));
      if (!columns.includes("matchesPlayed")) {
        db.run(`ALTER TABLE queue ADD COLUMN matchesPlayed INTEGER DEFAULT 0`);
      }
      if (!columns.includes("position")) {
        db.run(`ALTER TABLE queue ADD COLUMN position INTEGER DEFAULT 0`);
      }
    });
  });

  // ========== TABLE: current_match ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS current_match (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teamA TEXT NOT NULL,
      teamB TEXT NOT NULL,
      matchesPlayedA INTEGER DEFAULT 0,
      matchesPlayedB INTEGER DEFAULT 0,
      timestamp INTEGER DEFAULT (strftime('%s','now')*1000)
    )
  `);

  // Ensure current_match columns exist
  db.all("PRAGMA table_info(current_match)", (err, rows) => {
    if (!rows) return;
    const cols = rows.map(r => r.name);
    if (!cols.includes("matchesPlayedA")) db.run(`ALTER TABLE current_match ADD COLUMN matchesPlayedA INTEGER DEFAULT 0`);
    if (!cols.includes("matchesPlayedB")) db.run(`ALTER TABLE current_match ADD COLUMN matchesPlayedB INTEGER DEFAULT 0`);
  });

  // ========== TABLE: match_history ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teamA TEXT NOT NULL,
      teamB TEXT NOT NULL,
      winner TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

});

module.exports = db;
