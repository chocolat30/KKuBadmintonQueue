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
      timestamp INTEGER DEFAULT (strftime('%s','now')*1000)
    )
  `);

  // Add missing column matchesPlayed (if old DB exists)
  db.run(`ALTER TABLE queue ADD COLUMN matchesPlayed INTEGER DEFAULT 0`, err => {});

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

  // Add missing columns safely
  db.run(`ALTER TABLE current_match ADD COLUMN matchesPlayedA INTEGER DEFAULT 0`, err => {});
  db.run(`ALTER TABLE current_match ADD COLUMN matchesPlayedB INTEGER DEFAULT 0`, err => {});

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

  // Add winner column if missing
  db.run(`ALTER TABLE match_history ADD COLUMN winner TEXT`, err => {});

});

module.exports = db;
