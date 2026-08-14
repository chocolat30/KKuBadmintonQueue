const { runAsync, getAsync, allAsync } = require("../helpers/dbAsync");
const { getQueueWithEstimates } = require("../helpers/queueEstimation");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");

let io;

const courtService = {
  init(socketIo) {
    io = socketIo;
  },

  async broadcastCourtState(court_id) {
    const [{ queue, avgDuration }, match] = await Promise.all([
      getQueueWithEstimates(court_id),
      getAsync("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [court_id]),
    ]);
    // Emit only to clients viewing this court (they join `court:<id>` rooms)
    io.to(`court:${court_id}`).emit(`court:${court_id}`, {
      queue: queue || [],
      match: match || null,
      avgDuration: avgDuration || (10 * 60 * 1000),
    });
  },

  async saveUndoSnapshot(court_id) {
    const [queue, match, history] = await Promise.all([
      allAsync("SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC", [court_id]),
      getAsync("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [court_id]),
      allAsync("SELECT * FROM match_history WHERE court_id = ? ORDER BY id DESC LIMIT 5", [court_id]),
    ]);

    const snapshot = {
      queue: queue || [],
      current_match: match || null,
      match_history: history || [],
    };

    const ts = Date.now();
    await runAsync(
      "INSERT INTO undo_snapshot (court_id, data, timestamp) VALUES (?, ?, ?)",
      [court_id, JSON.stringify(snapshot), ts]
    );

    // Keep only the latest 10 snapshots per court
    await runAsync(
      `
      DELETE FROM undo_snapshot
      WHERE court_id = ? AND id NOT IN (
        SELECT id FROM undo_snapshot
        WHERE court_id = ?
        ORDER BY timestamp DESC
        LIMIT 10
      )
      `,
      [court_id, court_id]
    );
  },

  async normalizeQueuePositions(court_id) {
    const rows = await allAsync(
      "SELECT id FROM queue WHERE court_id = ? ORDER BY position ASC",
      [court_id]
    );

    await runAsync("BEGIN TRANSACTION");
    try {
      for (let i = 0; i < rows.length; i++) {
        await runAsync("UPDATE queue SET position = ? WHERE id = ?", [i + 1, rows[i].id]);
      }
      await runAsync("COMMIT");
    } catch (err) {
      await runAsync("ROLLBACK");
      throw err;
    }

    await this.broadcastCourtState(court_id);
  },

  // --- Court Management ---
  async getAllCourts() {
    const sql = `
      SELECT
        c.id,
        c.name,
        c.password,
        (SELECT COUNT(*) FROM queue WHERE court_id = c.id) +
        (SELECT COUNT(*) FROM current_match WHERE court_id = c.id) * 2 AS pairs
      FROM courts c
      ORDER BY c.id ASC
    `;
    const rows = await allAsync(sql);
    return rows || [];
  },

  async getCourtById(cid) {
    const court = await getAsync("SELECT * FROM courts WHERE id = ?", [cid]);
    return court || null;
  },

  async addCourt(name, password) {
    const courtUuid = uuidv4();
    let hashedPw = password || null;
    if (password) {
      hashedPw = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    }
    await runAsync(
      "INSERT INTO courts (name, password, uuid) VALUES (?, ?, ?)",
      [name, hashedPw, courtUuid]
    );
  },

  async deleteCourt(cid) {
    await runAsync("BEGIN TRANSACTION");
    try {
      await runAsync("DELETE FROM queue WHERE court_id = ?", [cid]);
      await runAsync("DELETE FROM current_match WHERE court_id = ?", [cid]);
      await runAsync("DELETE FROM match_history WHERE court_id = ?", [cid]);
      await runAsync("DELETE FROM undo_snapshot WHERE court_id = ?", [cid]);
      await runAsync("DELETE FROM courts WHERE id = ?", [cid]);
      await runAsync("COMMIT");
    } catch (err) {
      await runAsync("ROLLBACK");
      throw err;
    }
  },

  // --- Queue Logic ---
  async getCourtDetails(cid) {
    const court = await getAsync("SELECT * FROM courts WHERE id = ?", [cid]);
    if (!court) throw new Error("Court not found");
    const [queue, match] = await Promise.all([
      getQueueWithEstimates(cid),
      getAsync("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid]),
    ]);
    return { court, queue: queue.queue || [], match: match ? [match] : [] };
  },

  async joinQueue(cid, name) {
    await this.saveUndoSnapshot(cid);
    const row = await getAsync("SELECT MAX(position) AS maxPos FROM queue WHERE court_id = ?", [cid]);
    const nextPos = (row?.maxPos || 0) + 1;
    await runAsync(
      "INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)",
      [name, nextPos, cid]
    );
    await this.broadcastCourtState(cid);
  },

  async reorderQueue(cid, order) {
    await this.saveUndoSnapshot(cid);
    for (const item of order) {
      await runAsync(
        "UPDATE queue SET position = ? WHERE id = ? AND court_id = ?",
        [item.position, item.id, cid]
      );
    }
    await this.broadcastCourtState(cid);
  },

  async renamePlayer(cid, id, name) {
    await this.saveUndoSnapshot(cid);
    await runAsync(
      "UPDATE queue SET name = ? WHERE id = ? AND court_id = ?",
      [name, id, cid]
    );
    await this.broadcastCourtState(cid);
  },

  async removePlayerFromQueue(cid, id) {
    await this.saveUndoSnapshot(cid);
    await runAsync("DELETE FROM queue WHERE id = ? AND court_id = ?", [id, cid]);
    await this.normalizeQueuePositions(cid);
    await this.broadcastCourtState(cid);
  },

  async clearQueue(cid) {
    await this.saveUndoSnapshot(cid);
    await runAsync("DELETE FROM queue WHERE court_id = ?", [cid]);
    await this.broadcastCourtState(cid);
  },

  async undoAction(cid) {
    // Get the most recent snapshot (ordered by timestamp DESC)
    const row = await getAsync(
      "SELECT id, data FROM undo_snapshot WHERE court_id = ? ORDER BY timestamp DESC LIMIT 1",
      [cid]
    );
    if (!row) throw new Error("nothing_to_undo");
    const snap = JSON.parse(row.data);

    await runAsync("BEGIN TRANSACTION");
    try {
      await runAsync("DELETE FROM queue WHERE court_id = ?", [cid]);
      await runAsync("DELETE FROM current_match WHERE court_id = ?", [cid]);
      await runAsync("DELETE FROM match_history WHERE court_id = ?", [cid]);

      for (const q of snap.queue || []) {
        await runAsync(
          "INSERT INTO queue (id, name, matchesPlayed, position, court_id, timestamp) VALUES (?,?,?,?,?,?)",
          [q.id, q.name, q.matchesPlayed, q.position, q.court_id, q.timestamp]
        );
      }

      if (snap.current_match) {
        const m = snap.current_match;
        await runAsync(
          "INSERT INTO current_match (id, teamA, teamB, matchesPlayedA, matchesPlayedB, court_id, timestamp) VALUES (?,?,?,?,?,?,?)",
          [m.id, m.teamA, m.teamB, m.matchesPlayedA, m.matchesPlayedB, m.court_id, m.timestamp]
        );
      }

      for (const h of snap.match_history || []) {
        await runAsync(
          "INSERT INTO match_history (id, teamA, teamB, winner, court_id, timestamp, duration) VALUES (?,?,?,?,?,?,?)",
          [h.id, h.teamA, h.teamB, h.winner, h.court_id, h.timestamp, h.duration]
        );
      }

      // Only delete the specific snapshot that was just restored, not all of them
      await runAsync("DELETE FROM undo_snapshot WHERE id = ?", [row.id]);
      await runAsync("COMMIT");
    } catch (err) {
      await runAsync("ROLLBACK");
      throw err;
    }

    await this.broadcastCourtState(cid);
  },

  // --- Match Logic ---
  async startMatch(cid) {
    await this.saveUndoSnapshot(cid);
    const existing = await getAsync("SELECT * FROM current_match WHERE court_id=?", [cid]);
    if (existing) throw new Error("match_exists");
    const rows = await allAsync("SELECT * FROM queue WHERE court_id=? ORDER BY position ASC LIMIT 2", [cid]);
    if (!rows || rows.length < 2) throw new Error("not_enough_players");
    const [a, b] = rows;
    await runAsync(
      "INSERT INTO current_match (teamA, teamB, matchesPlayedA, matchesPlayedB, timestamp, court_id) VALUES (?,?,?,?,?,?)",
      [a.name, b.name, a.matchesPlayed, b.matchesPlayed, Date.now(), cid]
    );
    await runAsync("DELETE FROM queue WHERE id IN (?,?) AND court_id=?", [a.id, b.id, cid]);
    await this.normalizeQueuePositions(cid);
    await this.broadcastCourtState(cid);
  },

  async resetMatch(cid) {
    await this.saveUndoSnapshot(cid);
    const m = await getAsync("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid]);
    if (!m) throw new Error("no_match");
    const row = await getAsync("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid]);
    const nextPos = (row?.maxPos || 0) + 1;

    const names = [m.teamA, m.teamB];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (!name || name.trim() === "") continue;
      await runAsync(
        "INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)",
        [name, nextPos + i, cid]
      );
    }

    await this.normalizeQueuePositions(cid);
    await runAsync("DELETE FROM current_match WHERE court_id = ?", [cid]);
    await this.broadcastCourtState(cid);
  },

  async updateMatchScore(cid, side, delta) {
    await this.saveUndoSnapshot(cid);
    const m = await getAsync("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid]);
    if (!m) throw new Error("no_match");
    let a = m.matchesPlayedA || 0, b = m.matchesPlayedB || 0;
    if (side === "A") a += delta; else b += delta;
    if (a < 0 || b < 0) throw new Error("invalid_score");
    await runAsync(
      "UPDATE current_match SET matchesPlayedA=?, matchesPlayedB=? WHERE court_id = ?",
      [a, b, cid]
    );
    await this.broadcastCourtState(cid);
  },

  async endMatch(cid, winner) {
    await this.saveUndoSnapshot(cid);
    const m = await getAsync("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid]);
    if (!m) throw new Error("no_match");

    const winnerMatches = ((winner === "A" ? m.matchesPlayedA : m.matchesPlayedB) || 0) + 1;
    const winnerTeam = winner === "A" ? m.teamA : m.teamB;
    const loserTeam = winner === "A" ? m.teamB : m.teamA;
    const duration = Date.now() - (m.timestamp || Date.now());

    await runAsync(
      "INSERT INTO match_history (teamA, teamB, winner, timestamp, court_id, duration) VALUES (?, ?, ?, ?, ?, ?)",
      [m.teamA, m.teamB, winnerTeam, Date.now(), cid, duration]
    );

    const enqueue = async (name, mp) => {
      const row = await getAsync("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid]);
      const nextPos = (row?.maxPos || 0) + 1;
      await runAsync(
        "INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, ?, ?, ?)",
        [name, mp, nextPos, cid]
      );
    };

    await enqueue(loserTeam, 0);
    const winnerLeaves = winnerMatches >= 2;
    if (winnerLeaves) await enqueue(winnerTeam, 0);

    const need = winnerLeaves ? 2 : 1;
    const nextPairs = await allAsync(
      "SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC LIMIT ?",
      [cid, need]
    );

    const staying = [];
    if (!winnerLeaves) staying.push({ name: winnerTeam, matchesPlayed: winnerMatches });
    for (const p of nextPairs) staying.push({ name: p.name, matchesPlayed: p.matchesPlayed });
    const A = staying[0] || { name: null, matchesPlayed: 0 };
    const B = staying[1] || { name: null, matchesPlayed: 0 };

    await runAsync(
      "UPDATE current_match SET teamA=?, matchesPlayedA=?, teamB=?, matchesPlayedB=?, timestamp=? WHERE court_id = ?",
      [A.name, A.matchesPlayed, B.name, B.matchesPlayed, Date.now(), cid]
    );

    if (nextPairs.length > 0) {
      const placeholders = nextPairs.map(() => '?').join(',');
      await runAsync(
        `DELETE FROM queue WHERE id IN (${placeholders}) AND court_id = ?`,
        [...nextPairs.map(x => x.id), cid]
      );
    }

    await this.normalizeQueuePositions(cid);
    await this.broadcastCourtState(cid);
  },

  async walkOut(cid, side) {
    await this.saveUndoSnapshot(cid);
    const match = await getAsync("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid]);
    if (!match) throw new Error("no_match");

    const nextPair = await getAsync(
      "SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC LIMIT 1",
      [cid]
    );

    if (nextPair) {
      const teamA = side === 'A' ? nextPair.name : match.teamA;
      const matchesPlayedA = side === 'A' ? nextPair.matchesPlayed : match.matchesPlayedA;
      const teamB = side === 'B' ? nextPair.name : match.teamB;
      const matchesPlayedB = side === 'B' ? nextPair.matchesPlayed : match.matchesPlayedB;

      await runAsync(
        "UPDATE current_match SET teamA=?, matchesPlayedA=?, teamB=?, matchesPlayedB=?, timestamp=? WHERE court_id = ?",
        [teamA, matchesPlayedA, teamB, matchesPlayedB, Date.now(), cid]
      );
      await runAsync("DELETE FROM queue WHERE id = ? AND court_id = ?", [nextPair.id, cid]);
      await this.normalizeQueuePositions(cid);
      await this.broadcastCourtState(cid);
    } else {
      // No one in queue to replace, the match cannot continue
      await runAsync("DELETE FROM current_match WHERE court_id = ?", [cid]);
      await this.broadcastCourtState(cid);
    }
  },

  // --- History Logic ---
  async getGlobalHistory() {
    const rows = await allAsync("SELECT * FROM match_history ORDER BY id DESC LIMIT 200");
    return rows || [];
  },

  async getCourtHistory(cid) {
    const rows = await allAsync(
      "SELECT * FROM match_history WHERE court_id = ? ORDER BY id DESC LIMIT 200",
      [cid]
    );
    return rows || [];
  },

  async clearCourtHistory(cid) {
    await runAsync("DELETE FROM match_history WHERE court_id = ?", [cid]);
  },

  async clearGlobalHistory() {
    await runAsync("DELETE FROM match_history");
  },
};

module.exports = courtService;
