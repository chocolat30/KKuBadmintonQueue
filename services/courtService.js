const db = require("../db");
const { getQueueWithEstimates } = require("../helpers/queueEstimation");

let io;

const courtService = {
  init(socketIo) {
    io = socketIo;
  },

  async broadcastCourtState(court_id) {
    return new Promise((resolve, reject) => {
      getQueueWithEstimates(court_id, (err, queue, avgDuration) => {
        if (err) queue = [];
        db.get(
          "SELECT * FROM current_match WHERE court_id = ? LIMIT 1",
          [court_id],
          (e2, match) => {
            if (e2) return reject(e2);
            io.emit(`court:${court_id}`, {
              queue: queue || [],
              match: match || null,
              avgDuration: avgDuration || (10 * 60 * 1000),
            });
            resolve();
          }
        );
      });
    });
  },

  async saveUndoSnapshot(court_id) {
    return new Promise((resolve, reject) => {
      const snapshot = {};
      db.all(
        "SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC",
        [court_id],
        (e1, queue) => {
          snapshot.queue = queue || [];
          db.get(
            "SELECT * FROM current_match WHERE court_id = ? LIMIT 1",
            [court_id],
            (e2, match) => {
              snapshot.current_match = match || null;
              db.all(
                "SELECT * FROM match_history WHERE court_id = ? ORDER BY id DESC LIMIT 5",
                [court_id],
                (e3, history) => {
                  snapshot.match_history = history || [];
                  const ts = Date.now();
                  db.run(
                    `
                    INSERT INTO undo_snapshot (court_id, data, timestamp)
                    VALUES (?, ?, ?)
                    `,
                    [court_id, JSON.stringify(snapshot), ts],
                    (err) => {
                      if (err) return reject(err);
                      // Keep only the latest 10 snapshots per court
                      db.run(
                        `
                        DELETE FROM undo_snapshot
                        WHERE court_id = ? AND id NOT IN (
                          SELECT id FROM undo_snapshot
                          WHERE court_id = ?
                          ORDER BY timestamp DESC
                          LIMIT 10
                        )
                        `,
                        [court_id, court_id],
                        (err2) => (err2 ? reject(err2) : resolve())
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  },

  async normalizeQueuePositions(court_id) {
    return new Promise((resolve, reject) => {
      db.all(
        "SELECT id FROM queue WHERE court_id = ? ORDER BY position ASC",
        [court_id],
        (err, rows) => {
          if (err) return reject(err);

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const updates = rows.map((r, idx) => {
              return new Promise((res, rej) => {
                db.run("UPDATE queue SET position = ? WHERE id = ?", [idx + 1, r.id], e => (e ? rej(e) : res()));
              });
            });

            Promise.all(updates)
              .then(() => {
                db.run("COMMIT", () => {
                  this.broadcastCourtState(court_id).then(resolve).catch(reject);
                });
              })
              .catch(err => {
                db.run("ROLLBACK", () => reject(err));
              });
          });
        }
      );
    });
  },

  // --- Court Management ---
  async getAllCourts() {
    return new Promise((resolve, reject) => {
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
      db.all(sql, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  async getCourtById(cid) {
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM courts WHERE id = ?", [cid], (err, court) => {
        if (err) return reject(err);
        resolve(court || null);
      });
    });
  },

  async addCourt(name, password) {
    return new Promise((resolve, reject) => {
      db.all("SELECT id FROM courts ORDER BY id ASC", (err, rows) => {
        if (err) return reject(err);
        let newId = 1;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].id !== i + 1) {
            newId = i + 1;
            break;
          }
          newId = rows.length + 1;
        }
        db.run(
          "INSERT INTO courts (id, name, password) VALUES (?, ?, ?)",
          [newId, name, password || null],
          (e) => (e ? reject(e) : resolve())
        );
      });
    });
  },

  async deleteCourt(cid) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run("DELETE FROM queue WHERE court_id = ?", [cid]);
        db.run("DELETE FROM current_match WHERE court_id = ?", [cid]);
        db.run("DELETE FROM match_history WHERE court_id = ?", [cid]);
          db.run("DELETE FROM undo_snapshot WHERE court_id = ?", [cid]);
        db.run("DELETE FROM courts WHERE id = ?", [cid], (err) => {
          if (err) {
            db.run('ROLLBACK', () => reject(err));
          } else {
            db.run('COMMIT', resolve);
          }
        });
      });
    });
  },

  // --- Queue Logic ---
  async getCourtDetails(cid) {
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM courts WHERE id = ?", [cid], (err, court) => {
        if (err || !court) return reject(err || new Error("Court not found"));
        getQueueWithEstimates(cid, (e2, queue) => {
          db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (e3, match) => {
            if (e3) return reject(e3);
            resolve({ court, queue: queue || [], match: match ? [match] : [] });
          });
        });
      });
    });
  },

  async joinQueue(cid, name) {
    await this.saveUndoSnapshot(cid);
    return new Promise((resolve, reject) => {
      db.get("SELECT MAX(position) AS maxPos FROM queue WHERE court_id = ?", [cid], (err, row) => {
        if (err) return reject(err);
        const nextPos = (row?.maxPos || 0) + 1;
        db.run(
          "INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)",
          [name, nextPos, cid],
          async (e) => {
            if (e) return reject(e);
            await this.broadcastCourtState(cid);
            resolve();
          }
        );
      });
    });
  },

  async reorderQueue(cid, order) {
    await this.saveUndoSnapshot(cid);
    const updates = order.map(item => {
      return new Promise((resolve, reject) => {
        db.run("UPDATE queue SET position = ? WHERE id = ? AND court_id = ?", [item.position, item.id, cid], e => (e ? reject(e) : resolve()));
      });
    });
    await Promise.all(updates);
    await this.broadcastCourtState(cid);
  },

  async renamePlayer(cid, id, name) {
    await this.saveUndoSnapshot(cid);
    return new Promise((resolve, reject) => {
      db.run("UPDATE queue SET name = ? WHERE id = ? AND court_id = ?", [name, id, cid], async (e) => {
        if (e) return reject(e);
        await this.broadcastCourtState(cid);
        resolve();
      });
    });
  },

  async removePlayerFromQueue(cid, id) {
    await this.saveUndoSnapshot(cid);
    return new Promise((resolve, reject) => {
      db.run("DELETE FROM queue WHERE id = ? AND court_id = ?", [id, cid], async (e) => {
        if (e) return reject(e);
        await this.normalizeQueuePositions(cid);
        await this.broadcastCourtState(cid);
        resolve();
      });
    });
  },

  async clearQueue(cid) {
    await this.saveUndoSnapshot(cid);
    return new Promise((resolve, reject) => {
      db.run("DELETE FROM queue WHERE court_id = ?", [cid], async (e) => {
        if (e) return reject(e);
        await this.broadcastCourtState(cid);
        resolve();
      });
    });
  },

  async undoAction(cid) {
    return new Promise((resolve, reject) => {
      // Get the most recent snapshot (ordered by timestamp DESC)
      db.get(
        "SELECT id, data FROM undo_snapshot WHERE court_id = ? ORDER BY timestamp DESC LIMIT 1",
        [cid],
        (err, row) => {
          if (err) return reject(err);
          if (!row) return reject(new Error("nothing_to_undo"));
          const snap = JSON.parse(row.data);
          const snapshotId = row.id;

          db.serialize(() => {
            db.run("DELETE FROM queue WHERE court_id = ?", [cid]);
            db.run("DELETE FROM current_match WHERE court_id = ?", [cid]);
            db.run("DELETE FROM match_history WHERE court_id = ?", [cid]);

            snap.queue.forEach(q => {
              db.run("INSERT INTO queue VALUES (?,?,?,?,?,?)", [q.id, q.name, q.matchesPlayed, q.position, q.court_id, q.timestamp]);
            });

            if (snap.current_match) {
              const m = snap.current_match;
              db.run("INSERT INTO current_match VALUES (?,?,?,?,?,?,?)", [m.id, m.teamA, m.teamB, m.matchesPlayedA, m.matchesPlayedB, m.court_id, m.timestamp]);
            }

            snap.match_history.forEach(h => {
              db.run("INSERT INTO match_history (id, teamA, teamB, winner, court_id, timestamp, duration) VALUES (?,?,?,?,?,?,?)", [h.id, h.teamA, h.teamB, h.winner, h.court_id, h.timestamp, h.duration]);
            });

            // Only delete the specific snapshot that was just restored, not all of them
            db.run("DELETE FROM undo_snapshot WHERE id = ?", [snapshotId], async () => {
              await this.broadcastCourtState(cid);
              resolve();
            });
          });
        }
      );
    });
  },

  // --- Match Logic ---
  async startMatch(cid) {
    await this.saveUndoSnapshot(cid);
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM current_match WHERE court_id=?", [cid], (e, exist) => {
        if (exist) return reject(new Error("match_exists"));
        db.all("SELECT * FROM queue WHERE court_id=? ORDER BY position ASC LIMIT 2", [cid], (e2, rows) => {
          if (!rows || rows.length < 2) return reject(new Error("not_enough_players"));
          const [a, b] = rows;
          db.run(
            "INSERT INTO current_match (teamA, teamB, matchesPlayedA, matchesPlayedB, timestamp, court_id) VALUES (?,?,?,?,?,?)",
            [a.name, b.name, a.matchesPlayed, b.matchesPlayed, Date.now(), cid],
            () => {
              db.run("DELETE FROM queue WHERE id IN (?,?) AND court_id=?", [a.id, b.id, cid], async () => {
                await this.normalizeQueuePositions(cid);
                await this.broadcastCourtState(cid);
                resolve();
              });
            }
          );
        });
      });
    });
  },

  async resetMatch(cid) {
    await this.saveUndoSnapshot(cid);
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
        if (err || !m) return reject(err || new Error("no_match"));
        const names = [m.teamA, m.teamB];
        db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (er, row) => {
          let nextPos = (row?.maxPos || 0) + 1;
          const ops = names.map((name, idx) => {
            return new Promise((res) => {
              if (!name || name.trim() === "") return res();
              db.run("INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)", [name, nextPos + idx, cid], res);
            });
          });
          Promise.all(ops).then(async () => {
            await this.normalizeQueuePositions(cid);
            db.run("DELETE FROM current_match WHERE court_id = ?", [cid], async () => {
              await this.broadcastCourtState(cid);
              resolve();
            });
          }).catch(reject);
        });
      });
    });
  },

  async updateMatchScore(cid, side, delta) {
    await this.saveUndoSnapshot(cid);
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
        if (err || !m) return reject(err || new Error("no_match"));
        let a = m.matchesPlayedA || 0, b = m.matchesPlayedB || 0;
        if (side === "A") a += delta; else b += delta;
        if (a < 0 || b < 0) return reject(new Error("invalid_score"));
        db.run("UPDATE current_match SET matchesPlayedA=?, matchesPlayedB=? WHERE court_id = ?", [a, b, cid], async () => {
          await this.broadcastCourtState(cid);
          resolve();
        });
      });
    });
  },

  async endMatch(cid, winner) {
    await this.saveUndoSnapshot(cid);
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
        if (err || !m) return reject(err || new Error("no_match"));
        let matchesA = m.matchesPlayedA || 0;
        let matchesB = m.matchesPlayedB || 0;
        if (winner === "A") matchesA += 1; else matchesB += 1;
        const winnerTeam = winner === "A" ? m.teamA : m.teamB;
        const loserTeam = winner === "A" ? m.teamB : m.teamA;
        const winnerMatches = winner === "A" ? matchesA : matchesB;
        const duration = Date.now() - (m.timestamp || Date.now());

        db.run(
          "INSERT INTO match_history (teamA, teamB, winner, timestamp, court_id, duration) VALUES (?, ?, ?, ?, ?, ?)",
          [m.teamA, m.teamB, winnerTeam, Date.now(), cid, duration],
          async (err2) => {
            if (err2) return reject(err2);
            const enqueue = (name, mp) => new Promise((res) => {
              db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (er, row) => {
                const nextPos = (row?.maxPos || 0) + 1;
                db.run("INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, ?, ?, ?)", [name, mp, nextPos, cid], res);
              });
            });
            const ops = [enqueue(loserTeam, 0)];
            let winnerLeaves = winnerMatches >= 2;
            if (winnerLeaves) ops.push(enqueue(winnerTeam, 0));
            await Promise.all(ops);
            const need = winnerLeaves ? 2 : 1;
            db.all("SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC LIMIT ?", [cid, need], async (err4, nextPairs) => {
              if (err4) return reject(err4);
              const staying = [];
              if (!winnerLeaves) staying.push({ name: winnerTeam, matchesPlayed: winnerMatches });
              nextPairs.forEach(p => staying.push({ name: p.name, matchesPlayed: p.matchesPlayed }));
              const A = staying[0] || { name: null, matchesPlayed: 0 };
              const B = staying[1] || { name: null, matchesPlayed: 0 };
              db.run(
                "UPDATE current_match SET teamA=?, matchesPlayedA=?, teamB=?, matchesPlayedB=?, timestamp=? WHERE court_id = ?",
                [A.name, A.matchesPlayed, B.name, B.matchesPlayed, Date.now(), cid],
                async () => {
                  if (nextPairs.length > 0) {
                    const placeholders = nextPairs.map(() => '?').join(',');
                    db.run(`DELETE FROM queue WHERE id IN (${placeholders}) AND court_id = ?`, [...nextPairs.map(x => x.id), cid], async () => {
                      await this.normalizeQueuePositions(cid);
                      await this.broadcastCourtState(cid);
                      resolve();
                    });
                  } else {
                    await this.normalizeQueuePositions(cid);
                    await this.broadcastCourtState(cid);
                    resolve();
                  }
                }
              );
            });
          }
        );
      });
    });
  },

  // --- History Logic ---
  async getGlobalHistory() {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM match_history ORDER BY id DESC LIMIT 200", (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  async getCourtHistory(cid) {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM match_history WHERE court_id = ? ORDER BY id DESC LIMIT 200", [cid], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  async clearCourtHistory(cid) {
    return new Promise((resolve, reject) => {
      db.run("DELETE FROM match_history WHERE court_id = ?", [cid], (err) => (err ? reject(err) : resolve()));
    });
  },

  async clearGlobalHistory() {
    return new Promise((resolve, reject) => {
      db.run("DELETE FROM match_history", (err) => (err ? reject(err) : resolve()));
    });
  },
};

module.exports = courtService;
