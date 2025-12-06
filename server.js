const express = require("express");
const bodyParser = require("body-parser");
const db = require("./db");

const app = express();
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Home: player queue page
app.get("/", (req, res) => {
    db.all("SELECT * FROM queue ORDER BY id ASC", (err, rows) => {
        db.all("SELECT * FROM current_match ORDER BY id ASC", (err2, match) => {
            res.render("queue", { queue: rows, match });
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

// Admin panel
app.get("/admin", (req, res) => {
    db.all("SELECT * FROM queue ORDER BY id ASC", (err, rows) => {
        db.all("SELECT * FROM current_match ORDER BY id ASC", (err2, match) => {
            res.render("admin", { queue: rows, match });
        });
    });
});

// Start match: take first 2 queue rows (each row = 1 pair)
app.get("/start", (req, res) => {
    console.log("Start match triggered");

    // Get exactly 2 queue entries = 2 pairs
    db.all("SELECT * FROM queue ORDER BY id ASC LIMIT 2", (err, rows) => {
        if (err) {
            console.error(err);
            return res.sendStatus(500);
        }

        if (rows.length < 2) {
            console.log("Not enough pairs (need 2 pairs).");
            return res.redirect('/admin');
        }

        const pairA = rows[0].name;  // first pair
        const pairB = rows[1].name;  // second pair

        console.log("Starting match:", pairA, "vs", pairB);

        db.run(
            "INSERT INTO current_match (teamA, teamB) VALUES (?, ?)",
            [pairA, pairB],
            function (err) {
                if (err) {
                    console.error(err);
                    return res.sendStatus(500);
                }

                // Remove the 2 pairs from queue
                db.run(
                    "DELETE FROM queue WHERE id IN (?, ?)",
                    [rows[0].id, rows[1].id],
                    (err2) => {
                        if (err2) {
                            console.error(err2);
                            return res.sendStatus(500);
                        }

                        console.log("Match started successfully!");
                        res.redirect('/admin');
                    }
                );
            }
        );
    });
});


// End match
app.get("/end", (req, res) => {
    console.log("End match triggered");

    db.run("DELETE FROM current_match", () => {
        res.redirect("/admin");
    });
});

// Remove a pair from queue
app.get("/remove/:id", (req, res) => {
    db.run("DELETE FROM queue WHERE id = ?", [req.params.id], () => {
        res.redirect("/admin");
    });
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
