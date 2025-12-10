// server.js
const express = require("express");
const bodyParser = require("body-parser");
const db = require("./db");
const app = express();

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// --- Helper: normalize positions for a specific court
function normalizeQueuePositions(court_id, callback) {
  db.all("SELECT id FROM queue WHERE court_id = ? ORDER BY position ASC", [court_id], (err, rows) => {
    if (err) return callback && callback(err);
    const updates = rows.map((r, idx) => {
      return new Promise((resolve, reject) => {
        db.run("UPDATE queue SET position = ? WHERE id = ?", [idx + 1, r.id], (e) => e ? reject(e) : resolve());
      });
    });
    Promise.all(updates).then(() => callback && callback()).catch(callback);
  });
}

// --- Home: list courts (Option B)
app.get("/", (req, res) => {
  db.all("SELECT * FROM courts ORDER BY id ASC", (err, courts) => {
    if (err) courts = [];
    res.render("courts", { courts });
  });
});

// Add court (reuse smallest missing ID)
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
      [newId, `${name}`],
      () => {
        res.redirect("/");
      }
    );
  });
});

// Remove court (optional) - simple delete (will orphan data; you can extend to cascade)
app.post("/courts/:cid/delete", (req, res) => {
  const cid = req.params.cid;
  db.run("DELETE FROM courts WHERE id = ?", [cid], () => res.redirect("/"));
});

// --- Court page: show queue + current_match for that court
app.get("/court/:cid", (req, res) => {
  const cid = Number(req.params.cid);
  const { msg } = req.query;

  db.get("SELECT * FROM courts WHERE id = ?", [cid], (err, court) => {
    if (err || !court) return res.redirect("/");
    db.all("SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC", [cid], (errQ, queue) => {
      if (errQ) queue = [];
      db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (errM, match) => {
        if (errM) match = null;
        res.render("queue", { queue: queue || [], match: match ? [match] : [], court, msg });
      });
    });
  });
});

// --- Join queue for a court
app.post("/court/:cid/join", (req, res) => {
  const cid = Number(req.params.cid);
  const name = (req.body.name || "").trim();
  if (!name) return res.redirect(`/court/${cid}`);

  db.get("SELECT MAX(position) as maxPos FROM queue WHERE court_id = ?", [cid], (err, row) => {
    const nextPos = (row?.maxPos || 0) + 1;
    db.run("INSERT INTO queue (name, matchesPlayed, position, court_id) VALUES (?, 0, ?, ?)", [name, nextPos, cid], () => {
      res.redirect(`/court/${cid}`);
    });
  });
});

// --- Move up/down in a court's queue
app.get("/court/:cid/move/:id/:direction", (req, res) => {
  const cid = Number(req.params.cid);
  const id = Number(req.params.id);
  const direction = req.params.direction;

  db.get("SELECT id, position FROM queue WHERE id = ? AND court_id = ?", [id, cid], (err, current) => {
    if (!current) return res.redirect(`/court/${cid}?msg=notfound`);
    const swapPos = direction === "up" ? current.position - 1 : current.position + 1;
    db.get("SELECT id FROM queue WHERE position = ? AND court_id = ?", [swapPos, cid], (err2, swapWith) => {
      if (!swapWith) return res.redirect(`/court/${cid}?msg=topOrBottom`);
      db.run("UPDATE queue SET position = ? WHERE id = ?", [swapPos, current.id]);
      db.run("UPDATE queue SET position = ? WHERE id = ?", [current.position, swapWith.id], () => {
        normalizeQueuePositions(cid, () => res.redirect(`/court/${cid}`));
      });
    });
  });
});

// --- Start match on a court
app.get("/court/:cid/start", (req, res) => {
  const cid = Number(req.params.cid);
  db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, existing) => {
    if (err) return res.redirect(`/court/${cid}?msg=error`);
    if (existing) return res.redirect(`/court/${cid}?msg=active`);
    db.all("SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC LIMIT 2", [cid], (err2, rows) => {
      if (err2) return res.redirect(`/court/${cid}?msg=error`);
      if (!rows || rows.length < 2) return res.redirect(`/court/${cid}?msg=notenough`);
      const a = rows[0], b = rows[1];
      db.run(
        "INSERT INTO current_match (teamA, teamB, matchesPlayedA, matchesPlayedB, timestamp, court_id) VALUES (?, ?, ?, ?, ?, ?)",
        [a.name, b.name, a.matchesPlayed, b.matchesPlayed, Date.now(), cid],
        function (err3) {
          if (err3) return res.redirect(`/court/${cid}?msg=error`);
          db.run("DELETE FROM queue WHERE id IN (?, ?) AND court_id = ?", [a.id, b.id, cid], () => {
            normalizeQueuePositions(cid, () => res.redirect(`/court/${cid}?msg=started`));
          });
        }
      );
    });
  });
});

// --- End match (winner) for a court
app.get("/court/:cid/end", (req, res) => {
  const cid = Number(req.params.cid);
  const winner = req.query.w; // "A" or "B"
  if (!winner) return res.redirect(`/court/${cid}?msg=nowinner`);

  db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
    if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);

    let matchesA = m.matchesPlayedA || 0;
    let matchesB = m.matchesPlayedB || 0;
    if (winner === "A") matchesA += 1; else matchesB += 1;

    const winnerTeam = winner === "A" ? m.teamA : m.teamB;
    const loserTeam  = winner === "A" ? m.teamB : m.teamA;
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

// --- Reset match: put both back to queue for that court
app.get("/court/:cid/reset-match", (req, res) => {
  const cid = Number(req.params.cid);

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


// --- add-match (increment) and minus-match for a specific court
app.get("/court/:cid/add-match/:side", (req, res) => {
  const cid = Number(req.params.cid);
  const side = req.params.side; // A or B
  db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
    if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);
    let a = m.matchesPlayedA || 0, b = m.matchesPlayedB || 0;
    if (side === "A") a++; else b++;
    db.run("UPDATE current_match SET matchesPlayedA=?, matchesPlayedB=? WHERE court_id = ?", [a, b, cid], () => res.redirect(`/court/${cid}`));
  });
});

app.get("/court/:cid/minus-match/:side", (req, res) => {
  const cid = Number(req.params.cid);
  const side = req.params.side;
  db.get("SELECT * FROM current_match WHERE court_id = ? LIMIT 1", [cid], (err, m) => {
    if (err || !m) return res.redirect(`/court/${cid}?msg=nomatch`);
    const curr = side === "A" ? (m.matchesPlayedA || 0) : (m.matchesPlayedB || 0);
    if (curr <= 0) return res.redirect(`/court/${cid}?msg=invalid`);
    const newVal = curr - 1;
    const column = side === "A" ? "matchesPlayedA" : "matchesPlayedB";
    db.run(`UPDATE current_match SET ${column}=? WHERE court_id = ?`, [newVal, cid], () => res.redirect(`/court/${cid}`));
  });
});

// --- remove one from a court
app.get("/court/:cid/remove/:id", (req, res) => {
  const cid = Number(req.params.cid);
  const id = Number(req.params.id);
  db.run("DELETE FROM queue WHERE id = ? AND court_id = ?", [id, cid], () => normalizeQueuePositions(cid, () => res.redirect(`/court/${cid}`)));
});

// --- clear queue for a court
app.get("/court/:cid/clear-queue", (req, res) => {
  const cid = Number(req.params.cid);
  db.run("DELETE FROM queue WHERE court_id = ?", [cid], () => res.redirect(`/court/${cid}?msg=queuecleared`));
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



// --- history: global or per-court
app.get("/history", (req, res) => {
  db.all("SELECT * FROM match_history ORDER BY id DESC LIMIT 200", (err, rows) => {
    if (err) rows = [];
    res.render("history", { history: rows, court: null, msg: req.query.msg });
  });
});
app.get("/court/:cid/history", (req, res) => {
  const cid = Number(req.params.cid);
  db.all("SELECT * FROM match_history WHERE court_id = ? ORDER BY id DESC LIMIT 200", [cid], (err, rows) => {
    if (err) rows = [];
    db.get("SELECT * FROM courts WHERE id = ?", [cid], (er, court) => {
      res.render("history", { history: rows, court: court || { id: cid, name: `Court ${cid}` }, msg: req.query.msg });
    });
  });
});

// --- clear history (global or per-court)
app.get("/history/clear", (req, res) => {
  db.run("DELETE FROM match_history", () => res.redirect("/history?msg=cleared"));
});
app.get("/court/:cid/history/clear", (req, res) => {
  const cid = Number(req.params.cid);
  db.run("DELETE FROM match_history WHERE court_id = ?", [cid], () => res.redirect(`/court/${cid}/history?msg=cleared`));
});

// Start app
app.listen(3000, () => console.log("Server running on port 3000"));
