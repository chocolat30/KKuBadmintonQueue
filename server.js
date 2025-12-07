const express = require("express");
const bodyParser = require("body-parser");
const db = require("./db");

const app = express();
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// ----------------- Helper: Normalize Queue Positions -----------------
function normalizeQueuePositions(callback) {
    db.all("SELECT id FROM queue ORDER BY position ASC", (err, rows) => {
        if (err) return callback && callback(err);

        let updates = rows.map((row, index) => {
            return new Promise((resolve, reject) => {
                db.run("UPDATE queue SET position=? WHERE id=?", [index + 1, row.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        Promise.all(updates).then(() => callback && callback()).catch(callback);
    });
}

// ----------------- Home: Queue -----------------
app.get("/", (req, res) => {
    const { msg } = req.query;

    db.all("SELECT * FROM queue ORDER BY position ASC", (err, queue) => {
        if (err) {
            console.error(err);
            queue = [];
        }
        db.all("SELECT * FROM current_match ORDER BY id ASC", (err2, match) => {
            if (err2) {
                console.error(err2);
                match = [];
            }
            res.render("queue", { queue: queue || [], match: match || [], msg });
        });
    });
});

// ----------------- Join Queue -----------------
app.post("/join", (req, res) => {
    const { name } = req.body;

    db.get("SELECT MAX(position) as maxPos FROM queue", (err, row) => {
        const nextPos = (row?.maxPos || 0) + 1;
        db.run("INSERT INTO queue (name, matchesPlayed, position) VALUES (?, 0, ?)", [name, nextPos], () => {
            res.redirect("/");
        });
    });
});

// ----------------- Move Up/Down -----------------
app.get("/move/:id/:direction", (req, res) => {
    const { id, direction } = req.params;

    db.get("SELECT id, position FROM queue WHERE id = ?", [id], (err, current) => {
        if (!current) return res.redirect("/?msg=notfound");

        const swapPos = direction === "up" ? current.position - 1 : current.position + 1;

        db.get("SELECT id FROM queue WHERE position = ?", [swapPos], (err2, swapWith) => {
            if (!swapWith) return res.redirect("/?msg=topOrBottom");

            // Swap positions
            db.run("UPDATE queue SET position = ? WHERE id = ?", [swapPos, current.id]);
            db.run("UPDATE queue SET position = ? WHERE id = ?", [current.position, swapWith.id], () => {
                res.redirect("/");
            });
        });
    });
});

// ----------------- Start Match -----------------
app.get("/start", (req, res) => {
    db.all("SELECT * FROM current_match LIMIT 1", (err, existingMatch) => {
        if (err) return res.sendStatus(500);
        if (existingMatch.length > 0) return res.redirect("/?msg=active");

        db.all("SELECT * FROM queue ORDER BY position ASC LIMIT 2", (err2, rows) => {
            if (err2) return res.sendStatus(500);
            if (rows.length < 2) return res.redirect("/?msg=notenough");

            const pairA = rows[0];
            const pairB = rows[1];

            db.run(
                "INSERT INTO current_match (teamA, teamB, matchesPlayedA, matchesPlayedB, timestamp) VALUES (?, ?, ?, ?, ?)",
                [pairA.name, pairB.name, pairA.matchesPlayed, pairB.matchesPlayed, Date.now()],
                function (err3) {
                    if (err3) return res.sendStatus(500);

                    // Remove these pairs from queue and normalize positions
                    db.run("DELETE FROM queue WHERE id IN (?, ?)", [pairA.id, pairB.id], () => {
                        normalizeQueuePositions(() => res.redirect("/?msg=started"));
                    });
                }
            );
        });
    });
});

// ----------------- End Match -----------------
app.get("/end", (req, res) => {
    const winner = req.query.w; // "A" or "B"
    if (!winner) return res.redirect("/?msg=nowinner");

    db.all("SELECT * FROM current_match LIMIT 1", (err, rows) => {
        if (err) return res.sendStatus(500);
        if (rows.length === 0) return res.redirect("/?msg=nomatch");

        const m = rows[0];

        let teamA = m.teamA;
        let teamB = m.teamB;
        let matchesA = m.matchesPlayedA;
        let matchesB = m.matchesPlayedB;

        // Increment winner's match count
        if (winner === "A") matchesA += 1;
        else matchesB += 1;

        const winnerTeam = winner === "A" ? teamA : teamB;
        const loserTeam = winner === "A" ? teamB : teamA;

        // Save match to history
        db.run(
            "INSERT INTO match_history (teamA, teamB, winner, timestamp) VALUES (?, ?, ?, ?)",
            [teamA, teamB, winnerTeam, Date.now()],
            (err2) => {
                if (err2) return res.sendStatus(500);

                // Helper: send a player to the end of the queue
                const enqueuePlayer = (name, matchesPlayed) => {
                    db.get("SELECT MAX(position) as maxPos FROM queue", (err3, row) => {
                        const nextPos = (row?.maxPos || 0) + 1;
                        db.run(
                            "INSERT INTO queue (name, matchesPlayed, position) VALUES (?, ?, ?)",
                            [name, matchesPlayed, nextPos]
                        );
                    });
                };

                // Loser always goes to the end of the queue
                enqueuePlayer(loserTeam, 0);

                // Check if winner has played 2 matches; if yes, send to end of queue
                let winnerLeaves = false;
                if ((winner === "A" && matchesA >= 2) || (winner === "B" && matchesB >= 2)) {
                    enqueuePlayer(winnerTeam, 0);
                    winnerLeaves = true;
                }

                // Replace leaving player(s) with next pair(s) from queue
                db.all("SELECT * FROM queue ORDER BY position ASC LIMIT ?", [winnerLeaves ? 2 : 1], (err4, nextPairs) => {
                    const updates = [];

                    // Determine who stays in court
                    if (!winnerLeaves) {
                        if (winner === "A") updates.push({ name: teamA, matchesPlayed: matchesA });
                        else updates.push({ name: teamB, matchesPlayed: matchesB });
                    }

                    nextPairs.forEach(p => updates.push({ name: p.name, matchesPlayed: p.matchesPlayed }));

                    // Update current_match
                    const teamAUpdate = updates[0] || { name: null, matchesPlayed: 0 };
                    const teamBUpdate = updates[1] || { name: null, matchesPlayed: 0 };

                    db.run(
                        "UPDATE current_match SET teamA=?, matchesPlayedA=?, teamB=?, matchesPlayedB=?",
                        [teamAUpdate.name, teamAUpdate.matchesPlayed, teamBUpdate.name, teamBUpdate.matchesPlayed],
                        () => {
                            // Remove newly added pairs from queue and normalize positions
                            if (nextPairs.length > 0) {
                                const ids = nextPairs.map(p => p.id);
                                db.run(`DELETE FROM queue WHERE id IN (${ids.join(",")})`, () => {
                                    normalizeQueuePositions(() => res.redirect("/?msg=nextjoined"));
                                });
                            } else {
                                normalizeQueuePositions(() => res.redirect("/?msg=nextjoined"));
                            }
                        }
                    );
                });
            }
        );
    });
});

// ----------------- Reset Match -----------------
app.get("/reset-match", (req, res) => {
    db.all("SELECT * FROM current_match LIMIT 1", (err, match) => {
        if (err) return res.sendStatus(500);
        if (match.length === 0) return res.redirect("/?msg=nomatch");

        const m = match[0];
        const names = [m.teamA, m.teamB];

        db.get("SELECT MAX(position) as maxPos FROM queue", (err, row) => {
            const nextPos = (row?.maxPos || 0) + 1;
            names.forEach((name, idx) => {
                db.run(
                    "INSERT INTO queue (name, matchesPlayed, position) VALUES (?, 0, ?)",
                    [name, nextPos + idx]
                );
            });

            normalizeQueuePositions(() => {
                db.run("DELETE FROM current_match", () => res.redirect("/?msg=reset"));
            });
        });
    });
});

// ----------------- Clear Queue -----------------
app.get("/clear-queue", (req, res) => {
    db.run("DELETE FROM queue", (err) => {
        if (err) return res.sendStatus(500);
        res.redirect("/?msg=queuecleared");
    });
});

// ----------------- Match History -----------------
app.get("/history", (req, res) => {
    const { msg } = req.query;
    db.all("SELECT * FROM match_history ORDER BY id DESC", (err, rows) => {
        res.render("history", { history: rows, msg });
    });
});

// ----------------- Remove One -----------------
app.get("/remove/:id", (req, res) => {
    db.run("DELETE FROM queue WHERE id = ?", [req.params.id], () => {
        normalizeQueuePositions(() => res.redirect("/"));
    });
});

app.listen(3000, () => console.log("Server running on port 3000"));
