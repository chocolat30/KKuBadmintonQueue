const express = require("express");
const bodyParser = require("body-parser");
const db = require("./db");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: { origin: "*" }
});

// Import queue estimation helper
const { getQueueWithEstimates } = require("./helpers/queueEstimation");

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// Broadcast court state to all clients (with queue estimates)
function broadcastCourtState(court_id) {
  getQueueWithEstimates(court_id, (err, queue, avgDuration) => {
    if (err) queue = [];
    
    db.get(
      "SELECT * FROM current_match WHERE court_id = ? LIMIT 1",
      [court_id],
      (e2, match) => {
        io.emit(`court:${court_id}`, {
          queue: queue || [],
          match: match || null,
          avgDuration: avgDuration || (10 * 60 * 1000)
        });
      }
    );
  });
}

// undo helper
function saveUndoSnapshot(court_id, cb) {
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

              db.run(
                `
                INSERT INTO undo_snapshot (court_id, data, timestamp)
                VALUES (?, ?, ?)
                ON CONFLICT(court_id)
                DO UPDATE SET data=excluded.data, timestamp=excluded.timestamp
                `,
                [court_id, JSON.stringify(snapshot), Date.now()],
                cb
              );
            }
          );
        }
      );
    }
  );
}

// normalize queue helper
function normalizeQueuePositions(court_id, callback) {
  db.all(
    "SELECT id FROM queue WHERE court_id = ? ORDER BY position ASC",
    [court_id],
    (err, rows) => {
      if (err) return callback && callback(err);
      const updates = rows.map((r, idx) => {
        return new Promise((resolve, reject) => {
          db.run(
            "UPDATE queue SET position = ? WHERE id = ?",
            [idx + 1, r.id],
            e => (e ? reject(e) : resolve())
          );
        });
      });
      Promise.all(updates)
        .then(() => {
          callback && callback();
          // Broadcast after normalizing
          broadcastCourtState(court_id);
        })
        .catch(callback);
    }
  );
}

// Home page - list of courts
app.get("/", (req, res) => {
  db.all("SELECT * FROM courts ORDER BY id ASC", (err, courts) => {
    if (err) courts = [];
    res.render("courts", { courts });
  });
});

// Add courts
app.post("/courts/add", (req, res) => {
  const name = (req.body.name || "").trim() || "Court";

  db.all("SELECT id FROM courts ORDER BY id ASC", (err, rows) => {
    if (err) return res.redirect("/?msg=error");

    let newId = 1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id !== i + 1) {
        newId = i + 1;
        break;
      }
      newId = rows.length + 1;
    }

    db.run(
      "INSERT INTO courts (id, name) VALUES (?, ?)",
      [newId, name],
      () => res.redirect("/")
    );
  });
});

// Queue page for a court
app.get("/court/:cid", (req, res) => {
  const cid = Number(req.params.cid);
  const { msg } = req.query;

  db.get("SELECT * FROM courts WHERE id = ?", [cid], (err, court) => {
    if (!court) return res.redirect("/");
    
    // Use estimated queue
    getQueueWithEstimates(cid, (err, queue) => {
      db.get(
        "SELECT * FROM current_match WHERE court_id = ? LIMIT 1",
        [cid],
        (e2, match) => {
          res.render("queue", {
            queue: queue || [],
            match: match ? [match] : [],
            court,
            msg
          });
        }
      );
    });
  });
});

// Join queue
app.post("/court/:cid/join", (req, res) => {
  const cid = Number(req.params.cid);
  const name = (req.body.name || "").trim();
  if (!name) return res.redirect(`/court/${cid}`);

  saveUndoSnapshot(cid, () => {
    db.get(
      "SELECT MAX(position) AS maxPos FROM queue WHERE court_id = ?",
      [cid],
      (err, row) => {
        const nextPos = (row?.maxPos || 0) + 1;
        db.run(
          "INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)",
          [name, nextPos, cid],
          () => {
            broadcastCourtState(cid);
            res.json({ success: true });
          }
        );
      }
    );
  });
});

// Reorder queue via drag and drop
app.post("/court/:cid/reorder-queue", (req, res) => {
  const cid = Number(req.params.cid);
  const { order } = req.body;
  
  if (!order || !Array.isArray(order)) {
    return res.status(400).json({ error: "Invalid order" });
  }

  saveUndoSnapshot(cid, () => {
    const updates = order.map(item => {
      return new Promise((resolve, reject) => {
        db.run(
          "UPDATE queue SET position = ? WHERE id = ? AND court_id = ?",
          [item.position, item.id, cid],
          e => (e ? reject(e) : resolve())
        );
      });
    });

    Promise.all(updates)
      .then(() => {
        broadcastCourtState(cid);
        res.json({ success: true });
      })
      .catch(err => {
        console.error("Reorder error:", err);
        res.status(500).json({ error: "Reorder failed" });
      });
  });
});

// Start match
app.get("/court/:cid/start", (req, res) => {
  const cid = Number(req.params.cid);

  saveUndoSnapshot(cid, () => {
    db.get(
      "SELECT * FROM current_match WHERE court_id=?",
      [cid],
      (e, exist) => {
        if (exist) return res.redirect(`/court/${cid}`);
        db.all(
          "SELECT * FROM queue WHERE court_id=? ORDER BY position ASC LIMIT 2",
          [cid],
          (e2, rows) => {
            if (!rows || rows.length < 2)
              return res.redirect(`/court/${cid}`);
            const [a, b] = rows;
            db.run(
              "INSERT INTO current_match (teamA, teamB, matchesPlayedA, matchesPlayedB, timestamp, court_id) VALUES (?,?,?,?,?,?)",
              [a.name, b.name, a.matchesPlayed, b.matchesPlayed, Date.now(), cid],
              () => {
                db.run(
                  "DELETE FROM queue WHERE id IN (?,?) AND court_id=?",
                  [a.id, b.id, cid],
                  () =>
                    normalizeQueuePositions(cid, () =>
                      res.json({ success: true })
                    )
                );
              }
            );
          }
        );
      }
    );
  });
});

// Undo last action
app.get("/court/:cid/undo", (req, res) => {
  const cid = Number(req.params.cid);

  db.get(
    "SELECT data FROM undo_snapshot WHERE court_id=?",
    [cid],
    (err, row) => {
      if (!row) return res.json({ success: false, msg: "nothing_to_undo" });
      const snap = JSON.parse(row.data);

      db.serialize(() => {
        db.run("DELETE FROM queue WHERE court_id=?", [cid]);
        db.run("DELETE FROM current_match WHERE court_id=?", [cid]);
        db.run("DELETE FROM match_history WHERE court_id=?", [cid]);

        snap.queue.forEach(q => {
          db.run(
            "INSERT INTO queue VALUES (?,?,?,?,?,?)",
            [
              q.id,
              q.name,
              q.matchesPlayed,
              q.position,
              q.court_id,
              q.timestamp
            ]
          );
        });

        if (snap.current_match) {
          const m = snap.current_match;
          db.run(
            "INSERT INTO current_match VALUES (?,?,?,?,?,?,?)",
            [
              m.id,
              m.teamA,
              m.teamB,
              m.matchesPlayedA,
              m.matchesPlayedB,
              m.court_id,
              m.timestamp
            ]
          );
        }

        snap.match_history.forEach(h => {
          db.run(
            "INSERT INTO match_history (id, teamA, teamB, winner, court_id, timestamp, duration) VALUES (?,?,?,?,?,?,?)",
            [h.id, h.teamA, h.teamB, h.winner, h.court_id, h.timestamp, h.duration]
          );
        });

        db.run(
          "DELETE FROM undo_snapshot WHERE court_id=?",
          [cid],
          () => {
            broadcastCourtState(cid);
            res.redirect(`/court/${cid}?msg=undone`);
          }
        );
      });
    }
  );
});

// Reset match
app.get("/court/:cid/reset-match", (req, res) => {
  const cid = Number(req.params.cid);

  saveUndoSnapshot(cid, () => {
    db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
      if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);

      const names = [m.teamA, m.teamB];

      db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (er, row) => {
        let nextPos = (row?.maxPos || 0) + 1;

        const ops = names.map((name, idx) => {
          return new Promise((resolve) => {
            if (!name || name.trim() === "") return resolve();

            db.run(
              "INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)",
              [name, nextPos + idx, cid],
              resolve
            );
          });
        });

        Promise.all(ops).then(() => {
          normalizeQueuePositions(cid, () => {
            db.run("DELETE FROM current_match WHERE court_id = ?", [cid], () => {
              broadcastCourtState(cid);
              res.json({ success: true, msg: 'reset' });
            });
          });		
        });
      });
    });
  });
});

// Remove one from court
app.get("/court/:cid/remove/:id", (req, res) => {
  const cid = Number(req.params.cid);
  const id = Number(req.params.id);

  saveUndoSnapshot(cid, () => {
    db.run(
      "DELETE FROM queue WHERE id = ? AND court_id = ?",
      [id, cid],
      () => {
        normalizeQueuePositions(cid, () => {
          res.json({ success: true });
        });
      }
    );
  });
});

// Rename queue name 
app.post("/court/:cid/rename/:id", (req, res) => {
  const cid = Number(req.params.cid);
  const id = Number(req.params.id);
  const newName = (req.body.name || "").trim();

  if (!newName) return res.redirect(`/court/${cid}`);

  saveUndoSnapshot(cid, () => {
    db.run(
      "UPDATE queue SET name = ? WHERE id = ? AND court_id = ?",
      [newName, id, cid],
      () => {
        broadcastCourtState(cid);
        res.json({ success: true });
      }
    );
  });
});

// Add/minus match
app.get("/court/:cid/add-match/:side", (req, res) => {
  const cid = Number(req.params.cid);
  const side = req.params.side;
  saveUndoSnapshot(cid, () => {
    db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
      if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);
      let a = m.matchesPlayedA || 0, b = m.matchesPlayedB || 0;
      if (side === "A") a++; else b++;
      db.run("UPDATE current_match SET matchesPlayedA=?, matchesPlayedB=? WHERE court_id = ?", [a, b, cid], () => {
        broadcastCourtState(cid);
        res.redirect(`/court/${cid}`);
      });
    });
  });
});
app.get("/court/:cid/minus-match/:side", (req, res) => {
  const cid = Number(req.params.cid);
  const side = req.params.side;
  saveUndoSnapshot(cid, () => {
    db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
      if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);
      const curr = side === "A" ? (m.matchesPlayedA || 0) : (m.matchesPlayedB || 0);
      if (curr <= 0) return res.redirect(`/court/${cid}?msg=invalid`);
      const newVal = curr - 1;
      const column = side === "A" ? "matchesPlayedA" : "matchesPlayedB";
      db.run(`UPDATE current_match SET ${column}=? WHERE court_id = ?`, [newVal, cid], () => {
        broadcastCourtState(cid);
        res.redirect(`/court/${cid}`);
      });
    });
  });
});

// Clear court history
app.get("/court/:cid/history/clear", (req, res) => {
  const cid = Number(req.params.cid);
  db.run("DELETE FROM match_history WHERE court_id = ?", [cid], () => res.redirect(`/court/${cid}/history?msg=cleared`));
});

// Clear global history
app.get("/history/clear", (req, res) => {
  db.run("DELETE FROM match_history", () => res.redirect("/history?msg=cleared"));
});

// End match (winner) for a court
app.get("/court/:cid/end", (req, res) => {
  const cid = Number(req.params.cid);
  const winner = req.query.w;
  if (!winner) return res.redirect(`/court/${cid}?msg=nowinner`);

  saveUndoSnapshot(cid, () => {
    db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
      if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);

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
        (err2) => {
          if (err2) return res.redirect(`/court/${cid}?msg=error`);

          const enqueue = (name, mp) => new Promise((resolve) => {
            db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (er, row) => {
              const nextPos = (row?.maxPos || 0) + 1;
              db.run("INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, ?, ?, ?)", [name, mp, nextPos, cid], resolve);
            });
          });

          const ops = [enqueue(loserTeam, 0)];
          let winnerLeaves = winnerMatches >= 2;
          if (winnerLeaves) ops.push(enqueue(winnerTeam, 0));

          Promise.all(ops).then(() => {
            const need = winnerLeaves ? 2 : 1;
            db.all("SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC LIMIT ?", [cid, need], (err4, nextPairs) => {
              if (err4) return res.redirect(`/court/${cid}?msg=error`);
              const staying = [];
              if (!winnerLeaves) staying.push({ name: winnerTeam, matchesPlayed: winnerMatches });
              nextPairs.forEach(p => staying.push({ name: p.name, matchesPlayed: p.matchesPlayed }));

              const A = staying[0] || { name: null, matchesPlayed: 0 };
              const B = staying[1] || { name: null, matchesPlayed: 0 };

              db.run(
                "UPDATE current_match SET teamA=?, matchesPlayedA=?, teamB=?, matchesPlayedB=?, timestamp=? WHERE court_id = ?",
                [A.name, A.matchesPlayed, B.name, B.matchesPlayed, Date.now(), cid],
                () => {
                  if (nextPairs.length > 0) {
                    const ids = nextPairs.map(x => x.id).join(",");
                    db.run(`DELETE FROM queue WHERE id IN (${ids}) AND court_id = ?`, [cid], () => {
                      normalizeQueuePositions(cid, () => res.redirect(`/court/${cid}?msg=nextjoined`));
                    });
                  } else {
                    normalizeQueuePositions(cid, () => res.redirect(`/court/${cid}?msg=nextjoined`));
                  }
                }
              );
            });
          }).catch(() => res.redirect(`/court/${cid}?msg=error`));
        }
      );
    });
  });
});

// Delete court
app.get("/court/:cid/delete", (req, res) => {
  const cid = Number(req.params.cid);

  db.serialize(() => {
    db.run("DELETE FROM queue WHERE court_id = ?", [cid]);
    db.run("DELETE FROM current_match WHERE court_id = ?", [cid]);
    db.run("DELETE FROM match_history WHERE court_id = ?", [cid]);

    db.run("DELETE FROM courts WHERE id = ?", [cid], () => {
      res.redirect("/?msg=court_deleted");
    });
  });
});

// History pages
app.get("/history", (req, res) => {
  db.all("SELECT * FROM match_history ORDER BY id DESC LIMIT 200", (err, rows) => {
    if (err) rows = [];
    res.render("history", { history: rows, court: null, msg: req.query.msg });
  });
});

app.get("/court/:cid/history", (req, res) => {
  const cid = Number(req.params.cid);

  saveUndoSnapshot(cid, () => {
    db.all("SELECT * FROM match_history WHERE court_id = ? ORDER BY id DESC LIMIT 200", [cid], (err, rows) => {
      if (err) rows = [];
      db.get("SELECT * FROM courts WHERE id = ?", [cid], (er, court) => {
        res.render("history", { history: rows, court: court || { id: cid, name: `Court ${cid}` }, msg: req.query.msg });
      });
    });
  });
});

// Clear queue for a court
app.get("/court/:cid/clear-queue", (req, res) => {
  const cid = Number(req.params.cid);
  saveUndoSnapshot(cid, () => {
    db.run("DELETE FROM queue WHERE court_id = ?", [cid], () => {
      broadcastCourtState(cid);
      res.redirect(`/court/${cid}?msg=queuecleared`);
    });
  });
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("join-court", (courtId) => {
    socket.join(`court:${courtId}`);
    console.log(`Client ${socket.id} joined court:${courtId}`);
    broadcastCourtState(courtId);
  });

  socket.on("leave-court", (courtId) => {
    socket.leave(`court:${courtId}`);
    console.log(`Client ${socket.id} left court:${courtId}`);
  });

  socket.on("join-queue", (data) => {
    const { courtId, name } = data;
    const cid = Number(courtId);
    const trimmedName = (name || "").trim();
    if (!trimmedName) return;

    saveUndoSnapshot(cid, () => {
      db.get(
        "SELECT MAX(position) AS maxPos FROM queue WHERE court_id = ?",
        [cid],
        (err, row) => {
          const nextPos = (row?.maxPos || 0) + 1;
          db.run(
            "INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)",
            [trimmedName, nextPos, cid],
            () => {
              broadcastCourtState(cid);
            }
          );
        }
      );
    });
  });

  socket.on("start-match", (courtId) => {
    const cid = Number(courtId);

    saveUndoSnapshot(cid, () => {
      db.get(
        "SELECT * FROM current_match WHERE court_id=?",
        [cid],
        (e, exist) => {
          if (exist) return;
          db.all(
            "SELECT * FROM queue WHERE court_id=? ORDER BY position ASC LIMIT 2",
            [cid],
            (e2, rows) => {
              if (!rows || rows.length < 2) return;
              const [a, b] = rows;
              db.run(
                "INSERT INTO current_match (teamA, teamB, matchesPlayedA, matchesPlayedB, timestamp, court_id) VALUES (?,?,?,?,?,?)",
                [a.name, b.name, a.matchesPlayed, b.matchesPlayed, Date.now(), cid],
                () => {
                  db.run(
                    "DELETE FROM queue WHERE id IN (?,?) AND court_id=?",
                    [a.id, b.id, cid],
                    () =>
                      normalizeQueuePositions(cid, () =>
                        broadcastCourtState(cid)
                      )
                  );
                }
              );
            }
          );
        }
      );
    });
  });

  socket.on("reset-match", (courtId) => {
    const cid = Number(courtId);

    saveUndoSnapshot(cid, () => {
      db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
        if (err || !m) return;

        const names = [m.teamA, m.teamB];

        db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (er, row) => {
          let nextPos = (row?.maxPos || 0) + 1;

          const ops = names.map((name, idx) => {
            return new Promise((resolve) => {
              if (!name || name.trim() === "") return resolve();

              db.run(
                "INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)",
                [name, nextPos + idx, cid],
                resolve
              );
            });
          });

          Promise.all(ops).then(() => {
            normalizeQueuePositions(cid, () => {
              db.run("DELETE FROM current_match WHERE court_id = ?", [cid], () => {
                broadcastCourtState(cid);
              });
            });
          });
        });
      });
    });
  });

  socket.on("rename-queue", (data) => {
    const { courtId, queueId, name } = data;
    const cid = Number(courtId);
    const id = Number(queueId);
    const newName = (name || "").trim();
    if (!newName) return;

    saveUndoSnapshot(cid, () => {
      db.run(
        "UPDATE queue SET name = ? WHERE id = ? AND court_id = ?",
        [newName, id, cid],
        () => {
          broadcastCourtState(cid);
        }
      );
    });
  });

  socket.on("end-match", (data) => {
    const { courtId, winner } = data;
    const cid = Number(courtId);
    if (!winner) return;

    saveUndoSnapshot(cid, () => {
      db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
        if (err || !m) return;

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
          (err2) => {
            if (err2) return;

            const enqueue = (name, mp) => new Promise((resolve) => {
              db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (er, row) => {
                const nextPos = (row?.maxPos || 0) + 1;
                db.run("INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, ?, ?, ?)", [name, mp, nextPos, cid], resolve);
              });
            });

            const ops = [enqueue(loserTeam, 0)];
            let winnerLeaves = winnerMatches >= 2;
            if (winnerLeaves) ops.push(enqueue(winnerTeam, 0));

            Promise.all(ops).then(() => {
              const need = winnerLeaves ? 2 : 1;
              db.all("SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC LIMIT ?", [cid, need], (err4, nextPairs) => {
                if (err4) return;
                const staying = [];
                if (!winnerLeaves) staying.push({ name: winnerTeam, matchesPlayed: winnerMatches });
                nextPairs.forEach(p => staying.push({ name: p.name, matchesPlayed: p.matchesPlayed }));

                const A = staying[0] || { name: null, matchesPlayed: 0 };
                const B = staying[1] || { name: null, matchesPlayed: 0 };

                db.run(
                  "UPDATE current_match SET teamA=?, matchesPlayedA=?, teamB=?, matchesPlayedB=?, timestamp=? WHERE court_id = ?",
                  [A.name, A.matchesPlayed, B.name, B.matchesPlayed, Date.now(), cid],
                  () => {
                    if (nextPairs.length > 0) {
                      const ids = nextPairs.map(x => x.id).join(",");
                      db.run(`DELETE FROM queue WHERE id IN (${ids}) AND court_id = ?`, [cid], () => {
                        normalizeQueuePositions(cid, () => broadcastCourtState(cid));
                      });
                    } else {
                      normalizeQueuePositions(cid, () => broadcastCourtState(cid));
                    }
                  }
                );
              });
            }).catch(() => {});
          }
        );
      });
    });
  });

  socket.on("add-match", (data) => {
    const { courtId, side } = data;
    const cid = Number(courtId);
    saveUndoSnapshot(cid, () => {
      db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
        if (err || !m) return;
        let a = m.matchesPlayedA || 0, b = m.matchesPlayedB || 0;
        if (side === "A") a++; else b++;
        db.run("UPDATE current_match SET matchesPlayedA=?, matchesPlayedB=? WHERE court_id = ?", [a, b, cid], () => {
          broadcastCourtState(cid);
        });
      });
    });
  });

  socket.on("minus-match", (data) => {
    const { courtId, side } = data;
    const cid = Number(courtId);
    saveUndoSnapshot(cid, () => {
      db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
        if (err || !m) return;
        const curr = side === "A" ? (m.matchesPlayedA || 0) : (m.matchesPlayedB || 0);
        if (curr <= 0) return;
        const newVal = curr - 1;
        const column = side === "A" ? "matchesPlayedA" : "matchesPlayedB";
        db.run(`UPDATE current_match SET ${column}=? WHERE court_id = ?`, [newVal, cid], () => {
          broadcastCourtState(cid);
        });
      });
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Start server
server.listen(3000, () => console.log("Server running on port 3000"));