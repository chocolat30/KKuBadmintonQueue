const express = require("express");
const bodyParser = require("body-parser");
const db = require("./db");

const app = express();
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

//  Helper: Normalize Queue Positions 
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

//  Home: Queue 
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

//  Join Queue 
app.post("/join", (req, res) => {
    const { name } = req.body;

    db.get("SELECT MAX(position) as maxPos FROM queue", (err, row) => {
        const nextPos = (row?.maxPos || 0) + 1;
        db.run("INSERT INTO queue (name, matchesPlayed, position) VALUES (?, 0, ?)", [name, nextPos], () => {
            res.redirect("/");
        });
    });
});

//  Move Up/Down 
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

//  Start Match 
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

//  End Match 
app.get("/end", (req, res) => {
    const winner = req.query.w;
    if (!winner) return res.redirect("/?msg=nowinner");

    db.get("SELECT * FROM current_match LIMIT 1", (err, m) => {
        if (err || !m) return res.redirect("/?msg=nomatch");

        const teamA = m.teamA;
        const teamB = m.teamB;
        let matchesA = m.matchesPlayedA;
        let matchesB = m.matchesPlayedB;

        if (winner === "A") matchesA += 1;
        else matchesB += 1;

        const winnerTeam = winner === "A" ? teamA : teamB;
        const loserTeam = winner === "A" ? teamB : teamA;
        const winnerMatches = winner === "A" ? matchesA : matchesB;

        db.run(
            "INSERT INTO match_history (teamA, teamB, winner, timestamp) VALUES (?, ?, ?, ?)",
            [teamA, teamB, winnerTeam, Date.now()],
            (err2) => {
                if (err2) return res.sendStatus(500);

                const enqueue = (name, mp) =>
                    new Promise((resolve) => {
                        db.get("SELECT MAX(position) as maxPos FROM queue", (err3, row) => {
                            const nextPos = (row?.maxPos || 0) + 1;
                            db.run(
                                "INSERT INTO queue (name, matchesPlayed, position) VALUES (?, ?, ?)",
                                [name, mp, nextPos],
                                resolve
                            );
                        });
                    });

                let enqueueOperations = [];

                enqueueOperations.push(enqueue(loserTeam, 0));

                let winnerLeaves = winnerMatches >= 2;
                if (winnerLeaves) enqueueOperations.push(enqueue(winnerTeam, 0));

                // Wait until ALL inserts finish
                Promise.all(enqueueOperations).then(() => {

                    const needed = winnerLeaves ? 2 : 1;

                    db.all(
                        "SELECT * FROM queue ORDER BY position ASC LIMIT ?",
                        [needed],
                        (err4, nextPairs) => {

                            const staying = [];

                            if (!winnerLeaves) {
                                staying.push({
                                    name: winnerTeam,
                                    matchesPlayed: winnerMatches
                                });
                            }

                            nextPairs.forEach((p) =>
                                staying.push({
                                    name: p.name,
                                    matchesPlayed: p.matchesPlayed
                                })
                            );

                            const A = staying[0] || { name: null, matchesPlayed: 0 };
                            const B = staying[1] || { name: null, matchesPlayed: 0 };

                            db.run(
                                "UPDATE current_match SET teamA=?, matchesPlayedA=?, teamB=?, matchesPlayedB=?, timestamp=?",
                                [A.name, A.matchesPlayed, B.name, B.matchesPlayed, Date.now()],
                                () => {
                                    if (nextPairs.length > 0) {
                                        const ids = nextPairs.map((x) => x.id).join(",");
                                        db.run(
                                            `DELETE FROM queue WHERE id IN (${ids})`,
                                            () => normalizeQueuePositions(() =>
                                                res.redirect("/?msg=ended")
                                            )
                                        );
                                    } else {
                                        normalizeQueuePositions(() =>
                                            res.redirect("/?msg=ended")
                                        );
                                    }
                                }
                            );
                        }
                    );
                });
            }
        );
    });
});

//  Reset Match 
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

// Add one match to a side
app.get("/add-match/:side", (req, res) => {
    const side = req.params.side; // "A" or "B"

    db.get("SELECT * FROM current_match LIMIT 1", (err, m) => {
        if (err || !m) return res.redirect("/?msg=nomatch");

        let newA = m.matchesPlayedA;
        let newB = m.matchesPlayedB;

        if (side === "A") newA++;
        if (side === "B") newB++;

        db.run(
            "UPDATE current_match SET matchesPlayedA=?, matchesPlayedB=?",
            [newA, newB],
            (err2) => {
                if (err2) return res.redirect("/?msg=error");
                res.redirect("/?msg=addedOne");
            }
        );
    });
});

// Subtract one match from a side
app.get("/minus-match/:side", (req, res) => {
    const side = req.params.side; // A or B

    db.get(`SELECT * FROM current_match LIMIT 1`, (err, match) => {
        if (err || !match) return res.redirect("/?msg=nomatch");

        let current = side === "A" ? match.matchesPlayedA : match.matchesPlayedB;

        // Prevent negative numbers
        if (current <= 0) return res.redirect("/?msg=invalid");

        const newVal = current - 1;

        const column = side === "A" ? "matchesPlayedA" : "matchesPlayedB";

        db.run(`UPDATE current_match SET ${column} = ? WHERE id = ?`,
            [newVal, match.id],
            () => {
                res.redirect("/");
            }
        );
    });
});


// Clear Queue 
app.get("/clear-queue", (req, res) => {
    db.run("DELETE FROM queue", (err) => {
        if (err) return res.sendStatus(500);
        res.redirect("/?msg=queuecleared");
    });
});

//  Match History 
app.get("/history", (req, res) => {
    const { msg } = req.query;
    db.all("SELECT * FROM match_history ORDER BY id DESC", (err, rows) => {
        res.render("history", { history: rows, msg });
    });
});

// Clear entire match history
app.get("/clear-history", (req, res) => {
    db.run("DELETE FROM match_history", (err) => {
        if (err) return res.sendStatus(500);
        res.redirect("/history?msg=cleared");
    });
});


//  Remove One 
app.get("/remove/:id", (req, res) => {
    db.run("DELETE FROM queue WHERE id = ?", [req.params.id], () => {
        normalizeQueuePositions(() => res.redirect("/"));
    });
});

app.listen(3000, () => console.log("Server running on port 3000"));
