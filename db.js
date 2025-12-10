const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.join(__dirname, "queue.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {

  // ========== TABLE: courts ==========
  // Remove AUTOINCREMENT so IDs can be reused
  db.run(`
    CREATE TABLE IF NOT EXISTS courts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

  // Ensure AUTOINCREMENT is removed (for existing DBs)
  db.all("PRAGMA table_info(courts)", (err, rows) => {
    const hasAuto = rows.some(r => r.pk === 1 && r.type.includes("AUTOINCREMENT"));
    if (hasAuto) {
      // rebuild table without AUTOINCREMENT
      db.run(`ALTER TABLE courts RENAME TO courts_old`);
      db.run(`
        CREATE TABLE courts (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);
      db.run(`INSERT INTO courts (id, name) SELECT id, name FROM courts_old`);
      db.run(`DROP TABLE courts_old`);
    }
  });

  // ========== TABLE: queue ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      matchesPlayed INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      court_id INTEGER NOT NULL,
      timestamp INTEGER DEFAULT (strftime('%s','now')*1000)
    )
  `);

  db.all("PRAGMA table_info(queue)", (err, rows) => {
    if (!rows) return;
    const cols = rows.map(r => r.name);
    if (!cols.includes("matchesPlayed"))
      db.run(`ALTER TABLE queue ADD COLUMN matchesPlayed INTEGER DEFAULT 0`);
    if (!cols.includes("position"))
      db.run(`ALTER TABLE queue ADD COLUMN position INTEGER DEFAULT 0`);
    if (!cols.includes("court_id"))
      db.run(`ALTER TABLE queue ADD COLUMN court_id INTEGER DEFAULT 1`);
  });

  // ========== TABLE: current_match ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS current_match (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teamA TEXT NOT NULL,
      teamB TEXT NOT NULL,
      matchesPlayedA INTEGER DEFAULT 0,
      matchesPlayedB INTEGER DEFAULT 0,
      court_id INTEGER NOT NULL,
      timestamp INTEGER DEFAULT (strftime('%s','now')*1000)
    )
  `);

  db.all("PRAGMA table_info(current_match)", (err, rows) => {
    if (!rows) return;
    const cols = rows.map(r => r.name);
    if (!cols.includes("matchesPlayedA"))
      db.run(`ALTER TABLE current_match ADD COLUMN matchesPlayedA INTEGER DEFAULT 0`);
    if (!cols.includes("matchesPlayedB"))
      db.run(`ALTER TABLE current_match ADD COLUMN matchesPlayedB INTEGER DEFAULT 0`);
    if (!cols.includes("court_id"))
      db.run(`ALTER TABLE current_match ADD COLUMN court_id INTEGER DEFAULT 1`);
  });

  // ========== TABLE: match_history ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teamA TEXT NOT NULL,
      teamB TEXT NOT NULL,
      winner TEXT,
      court_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  db.all("PRAGMA table_info(match_history)", (err, rows) => {
    if (!rows) return;
    const cols = rows.map(r => r.name);
    if (!cols.includes("court_id"))
      db.run(`ALTER TABLE match_history ADD COLUMN court_id INTEGER DEFAULT 1`);
  });

});

module.exports = db;
