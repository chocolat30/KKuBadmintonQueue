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
                "INSERT INTO current_match (teamA, teamB) VALUES (?, ?)",
                [pairA, pairB],
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

// End match (send both pairs to end of queue, save history, clear match)
app.get("/end", (req, res) => {
    console.log("End match triggered");

    db.all("SELECT * FROM current_match LIMIT 1", (err, match) => {
        if (err) return res.sendStatus(500);

        if (match.length === 0) {
            return res.redirect("/?msg=nomatch");
        }

        const m = match[0];

        // 1. Insert match into history
        db.run(
            "INSERT INTO match_history (teamA, teamB, timestamp) VALUES (?, ?, ?)",
            [m.teamA, m.teamB, m.timestamp],
            (err2) => {
                if (err2) return res.sendStatus(500);

                // 2. Re-insert both pairs back into queue (looping)
                db.run(
                    "INSERT INTO queue (name) VALUES (?), (?)",
                    [m.teamA, m.teamB],
                    (err3) => {
                        if (err3) return res.sendStatus(500);

                        // 3. Delete current match
                        db.run("DELETE FROM current_match", (err4) => {
                            if (err4) return res.sendStatus(500);

                            console.log("Match ended and recycled back to queue.");
                            res.redirect("/?msg=looped");
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
