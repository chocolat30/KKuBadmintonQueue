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



// End match
app.get("/end", (req, res) => {
    console.log("End match triggered");

    db.all("SELECT * FROM current_match LIMIT 1", (err, match) => {
        if (err) return res.sendStatus(500);

        if (match.length === 0) {
            return res.redirect("/?msg=nomatch");
        }

        const m = match[0];

        // Insert into history
        db.run(
            "INSERT INTO match_history (teamA, teamB, timestamp) VALUES (?, ?, ?)",
            [m.teamA, m.teamB, m.timestamp],
            (err2) => {
                if (err2) return res.sendStatus(500);

                // Clear current match
                db.run("DELETE FROM current_match", () => {
                    res.redirect("/history?msg=added");
                });
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
