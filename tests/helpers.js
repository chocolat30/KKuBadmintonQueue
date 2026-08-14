// Shared test helpers. Each test file must set process.env.DB_PATH before
// requiring anything that loads db.js (e.g. ':memory:' or a temp file).
const { runAsync, getAsync } = require('../helpers/dbAsync');
const courtService = require('../services/courtService');

// Wipe all tables in FK-safe order, keeping the schema intact.
async function resetDb() {
  await runAsync('DELETE FROM undo_snapshot');
  await runAsync('DELETE FROM match_history');
  await runAsync('DELETE FROM current_match');
  await runAsync('DELETE FROM queue');
  await runAsync('DELETE FROM courts');
}

// Create a court and return its id (ids restart at 1 after resetDb).
async function seedCourt(name, password) {
  await courtService.addCourt(name, password || '');
  const row = await getAsync('SELECT id FROM courts ORDER BY id DESC LIMIT 1');
  return row.id;
}

module.exports = { resetDb, seedCourt, runAsync, getAsync };
