// server.js
const express = require("express");
const bodyParser = require("body-parser");
const db = require("./db");
const app = express();

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

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
        .then(() => callback && callback())
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

    // Find smallest missing ID (slot)
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
    db.all(
      "SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC",
      [cid],
      (e, queue) => {
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
      }
    );
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
          () => res.redirect(`/court/${cid}`)
        );
      }
    );
  });
});

// Move queue up/down
app.get("/court/:cid/move/:id/:direction", (req, res) => {
  const cid = Number(req.params.cid);

  saveUndoSnapshot(cid, () => {
    const id = Number(req.params.id);
    const direction = req.params.direction;

    db.get(
      "SELECT id, position FROM queue WHERE id = ? AND court_id = ?",
      [id, cid],
      (err, current) => {
        if (!current) return res.redirect(`/court/${cid}`);
        const swapPos =
          direction === "up"
            ? current.position - 1
            : current.position + 1;

        db.get(
          "SELECT id FROM queue WHERE position = ? AND court_id = ?",
          [swapPos, cid],
          (err2, swapWith) => {
            if (!swapWith) return res.redirect(`/court/${cid}`);
            db.run("UPDATE queue SET position=? WHERE id=?", [
              swapPos,
              current.id
            ]);
            db.run(
              "UPDATE queue SET position=? WHERE id=?",
              [current.position, swapWith.id],
              () => normalizeQueuePositions(cid, () => res.redirect(`/court/${cid}`))
            );
          }
        );
      }
    );
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
                      res.redirect(`/court/${cid}`)
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
      if (!row) return res.redirect(`/court/${cid}?msg=nothing_to_undo`);
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
            "INSERT INTO match_history VALUES (?,?,?,?,?,?)",
            [h.id, h.teamA, h.teamB, h.winner, h.court_id, h.timestamp]
          );
        });

        db.run(
          "DELETE FROM undo_snapshot WHERE court_id=?",
          [cid],
          () => res.redirect(`/court/${cid}?msg=undone`)
        );
      });
    }
  );
});

// --- Reset match: put both back to queue for that court
app.get("/court/:cid/reset-match", (req, res) => {
  const cid = Number(req.params.cid);

  saveUndoSnapshot(cid, () => {
    db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
      if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);

      // DO NOT FILTER WITH Boolean()
      const names = [m.teamA, m.teamB];

      db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (er, row) => {
        let nextPos = (row?.maxPos || 0) + 1;

        const ops = names.map((name, idx) => {
          return new Promise((resolve) => {

            // prevent dropping second team
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
            db.run("DELETE FROM current_match WHERE court_id = ?", [cid], () =>
              res.redirect(`/court/${cid}?msg=reset`)
            );
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
          res.redirect(`/court/${cid}`);
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

  // snapshot for undo 
  saveUndoSnapshot(cid, () => {
    db.run(
      "UPDATE queue SET name = ? WHERE id = ? AND court_id = ?",
      [newName, id, cid],
      () => res.redirect(`/court/${cid}`)
    );
  });
});


// --- add-match (increment) and minus-match for a specific court
app.get("/court/:cid/add-match/:side", (req, res) => {
  const cid = Number(req.params.cid);
  const side = req.params.side; // A or B
  saveUndoSnapshot(cid, () => {
    db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
      if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);
      let a = m.matchesPlayedA || 0, b = m.matchesPlayedB || 0;
      if (side === "A") a++; else b++;
      db.run("UPDATE current_match SET matchesPlayedA=?, matchesPlayedB=? WHERE court_id = ?", [a, b, cid], () => res.redirect(`/court/${cid}`));
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
      db.run(`UPDATE current_match SET ${column}=? WHERE court_id = ?`, [newVal, cid], () => res.redirect(`/court/${cid}`));
    });
  });
});

// clear court history
app.get("/court/:cid/history/clear", (req, res) => {
  const cid = Number(req.params.cid);
  db.run("DELETE FROM match_history WHERE court_id = ?", [cid], () => res.redirect(`/court/${cid}/history?msg=cleared`));
});

// --- clear history (global)
app.get("/history/clear", (req, res) => {
  db.run("DELETE FROM match_history", () => res.redirect("/history?msg=cleared"));
});

// --- End match (winner) for a court
app.get("/court/:cid/end", (req, res) => {
  const cid = Number(req.params.cid);
  const winner = req.query.w; // "A" or "B"
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

      // record history then enqueue loser and maybe winner
      db.run(
        "INSERT INTO match_history (teamA, teamB, winner, timestamp, court_id) VALUES (?, ?, ?, ?, ?)",
        [m.teamA, m.teamB, winnerTeam, Date.now(), cid],
        (err2) => {
          if (err2) return res.redirect(`/court/${cid}?msg=error`);

          // helpers to enqueue to same court
          const enqueue = (name, mp) => new Promise((resolve) => {
            db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (er, row) => {
              const nextPos = (row?.maxPos || 0) + 1;
              db.run("INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, ?, ?, ?)", [name, mp, nextPos, cid], resolve);
            });
          });

          // always enqueue loser
          const ops = [enqueue(loserTeam, 0)];
          let winnerLeaves = winnerMatches >= 2;
          if (winnerLeaves) ops.push(enqueue(winnerTeam, 0));

          Promise.all(ops).then(() => {
            const need = winnerLeaves ? 2 : 1;
            // fetch next pairs from this court's queue
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

// Delete court, no shifting
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

// global history and per-court
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

// --- clear queue for a court
app.get("/court/:cid/clear-queue", (req, res) => {
  const cid = Number(req.params.cid);
  saveUndoSnapshot(cid, () => {
  db.run("DELETE FROM queue WHERE court_id = ?", [cid], () => res.redirect(`/court/${cid}?msg=queuecleared`));
  });
});

// Start server
app.listen(3000, () => console.log("Server running on port 3000"));
