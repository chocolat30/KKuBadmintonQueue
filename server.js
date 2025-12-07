const express = require("express");
const bodyParser = require("body-parser");
const db = require("./db");

const app = express();
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Home: player queue page
app.get("/", (req, res) => {
    const { msg } = req.query;

    db.all("SELECT * FROM queue ORDER BY id ASC", (err, rows) => {
        db.all("SELECT * FROM current_match ORDER BY id ASC", (err2, match) => {
            res.render("queue", { queue: rows, match, msg });
        });
    });
});

// Join queue
app.post("/join", (req, res) => {
    const { name } = req.body;

    db.run("INSERT INTO queue (name) VALUES (?)", [name], () => {
        res.redirect("/");
    });
});

// Start match: take first 2 queue rows (each row = 1 pair)
// Start match: only if no match is active
app.get("/start", (req, res) => {
    console.log("Start match triggered");

    // 1. Check if a match already exists
    db.all("SELECT * FROM current_match LIMIT 1", (err, existingMatch) => {
        if (err) {
            console.error(err);
            return res.sendStatus(500);
        }

        if (existingMatch.length > 0) {
            console.log("A match is already active. Cannot start another.");
            return res.redirect("/?msg=active");
        }

        // 2. Get exactly 2 queue entries = 2 pairs
        db.all("SELECT * FROM queue ORDER BY id ASC LIMIT 2", (err2, rows) => {
            if (err2) {
                console.error(err2);
                return res.sendStatus(500);
            }

            if (rows.length < 2) {
                console.log("Not enough pairs (need 2 pairs).");
                return res.redirect("/?msg=notenough");
            }

            const pairA = rows[0].name;
            const pairB = rows[1].name;

            console.log("Starting match:", pairA, "vs", pairB);

            // 3. Insert match
            db.run(
                "INSERT INTO current_match (teamA, teamB, matchesPlayedA, matchesPlayedB, timestamp) VALUES (?, ?, 0, 0, ?)",
                [pairA, pairB, Date.now()],
                function (err3) {
                    if (err3) {
                        console.error(err3);
                        return res.sendStatus(500);
                    }

                    // 4. Remove the two pairs from queue
                    db.run(
                        "DELETE FROM queue WHERE id IN (?, ?)",
                        [rows[0].id, rows[1].id],
                        (err4) => {
                            if (err4) {
                                console.error(err4);
                                return res.sendStatus(500);
                            }

                            console.log("Match started successfully!");
                            res.redirect("/");
                        }
                    );
                }
            );
        });
    });
});

// Remove ALL pairs from queue
app.get("/clear-queue", (req, res) => {
    db.run("DELETE FROM queue", (err) => {
        if (err) return res.sendStatus(500);
        res.redirect("/?msg=queuecleared");
    });
});

// End match with winner logic
app.get("/end", (req, res) => {
    const winner = req.query.w; // "A" or "B"
    if (!winner) return res.redirect("/?msg=nowinner");

    db.all("SELECT * FROM current_match LIMIT 1", (err, rows) => {
        if (err) return res.sendStatus(500);
        if (rows.length === 0) return res.redirect("/?msg=nomatch");

        const m = rows[0];

        const teamA = m.teamA;
        const teamB = m.teamB;

        let matchesA = m.matchesPlayedA;
        let matchesB = m.matchesPlayedB;

        // Determine winner / loser
        const winnerTeam = winner === "A" ? teamA : teamB;
        const loserTeam = winner === "A" ? teamB : teamA;

        let winnerMatches = winner === "A" ? matchesA : matchesB;
        winnerMatches += 1; // add 1 match for the winner

        // loser resets counter
        const loserMatchesReset = 0;

        // Save match to history
        db.run(
            "INSERT INTO match_history (teamA, teamB, winner, timestamp) VALUES (?, ?, ?, ?)",
            [teamA, teamB, winnerTeam, Date.now()],
            (err2) => {
                if (err2) return res.sendStatus(500);

                // Insert loser back to queue
                db.run(
                    "INSERT INTO queue (name, matchesPlayed) VALUES (?, ?)",
                    [loserTeam, loserMatchesReset],
                    (err3) => {
                        if (err3) return res.sendStatus(500);

                        // Winner stays or leaves?
                        if (winnerMatches >= 2) {
                            // Winner must leave the court also
                            db.run(
                                "INSERT INTO queue (name, matchesPlayed) VALUES (?, ?)",
                                [winnerTeam, 0],
                                (err4) => {
                                    if (err4) return res.sendStatus(500);

                                    // Clear current match
                                    db.run("DELETE FROM current_match", () => {
                                        // Now pull next 2 pairs for a fresh match
                                        db.all("SELECT * FROM queue ORDER BY id ASC LIMIT 2", (err5, next2) => {
                                            if (next2.length < 2) {
                                                return res.redirect("/?msg=waiting");
                                            }

                                            const p1 = next2[0];
                                            const p2 = next2[1];

                                            db.run(
                                                "INSERT INTO current_match (teamA, teamB, matchesPlayedA, matchesPlayedB, timestamp) VALUES (?, ?, ?, ?, ?)",
                                                [p1.name, p2.name, p1.matchesPlayed, p2.matchesPlayed, Date.now()],
                                                () => {
                                                    db.run("DELETE FROM queue WHERE id IN (?,?)", [p1.id, p2.id]);
                                                    res.redirect("/?msg=newmatch");
                                                }
                                            );
                                        });
                                    });
                                }
                            );
                        } else {
                            // Winner stays with updated matchesPlayed

                            const winnerField = winner === "A" ? "teamA" : "teamB";
                            const winnerMatchesField = winner === "A" ? "matchesPlayedA" : "matchesPlayedB";

                            // Update match state
                            const updateSQL = `UPDATE current_match SET ${winnerMatchesField} = ?`;
                            db.run(updateSQL, [winnerMatches], (err6) => {
                                if (err6) return res.sendStatus(500);

                                // Pull one pair from queue
                                db.all("SELECT * FROM queue ORDER BY id ASC LIMIT 1", (err7, next1) => {
                                    if (next1.length < 1) {
                                        return res.redirect("/?msg=waiting1");
                                    }

                                    const newTeam = next1[0];

                                    // Replace loser with new team
                                    const teamField = winner === "A" ? "teamB" : "teamA";
                                    const matchesField = winner === "A" ? "matchesPlayedB" : "matchesPlayedA";

                                    db.run(
                                        `UPDATE current_match SET ${teamField}=?, ${matchesField}=?`,
                                        [newTeam.name, newTeam.matchesPlayed],
                                        () => {
                                            db.run("DELETE FROM queue WHERE id = ?", [newTeam.id]);
                                            res.redirect("/?msg=nextjoined");
                                        }
                                    );
                                });
                            });
                        } // end else winner stays
                    }
                );
            }
        );
    });
});

// RESET MATCH: Clears current match and returns players to queue with 0 matchesPlayed
app.get("/reset-match", (req, res) => {
    console.log("Reset match triggered");

    db.all("SELECT * FROM current_match LIMIT 1", (err, match) => {
        if (err) return res.sendStatus(500);

        if (match.length === 0) {
            return res.redirect("/?msg=nomatch");
        }

        const m = match[0];

        // 1. Insert both pairs back into queue with matchesPlayed = 0
        db.run(
            "INSERT INTO queue (name, matchesPlayed) VALUES (?, 0)",
            [m.teamA],
            () => {
                db.run(
                    "INSERT INTO queue (name, matchesPlayed) VALUES (?, 0)",
                    [m.teamB],
                    () => {
                        // 2. Delete match
                        db.run("DELETE FROM current_match", (err2) => {
                            if (err2) return res.sendStatus(500);

                            console.log("Match reset completed.");
                            res.redirect("/?msg=reset");
                        });
                    }
                );
            }
        );
    });
});


//Match history page
app.get("/history", (req, res) => {
    const { msg } = req.query;

    db.all("SELECT * FROM match_history ORDER BY id DESC", (err, rows) => {
        res.render("history", { history: rows, msg });
    });
});


// Remove a pair from queue
app.get("/remove/:id", (req, res) => {
    db.run("DELETE FROM queue WHERE id = ?", [req.params.id], () => {
        res.redirect("/");
    });
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
