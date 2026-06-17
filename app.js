const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
require("dotenv").config().parsed || {};

const db = require("./db");
const courtService = require("./services/courtService");
const courtRoutes = require("./routes/courts");
const queueRoutes = require("./routes/queue");
const matchRoutes = require("./routes/match");
const historyRoutes = require("./routes/history");

const app = express();

// Cache-buster version from package.json
const APP_VERSION = require('./package.json').version;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public", {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("i18n.js")) {
      // Always revalidate i18n.js — prevents stale cached translations
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

// Inject app version into all templates for cache-busting
app.use((req, res, next) => {
  res.locals.APP_VERSION = APP_VERSION;
  next();
});

// Routes
app.use("/", courtRoutes);
app.use("/", historyRoutes);
app.use("/court", queueRoutes);
app.use("/court", matchRoutes);

// Explicit court routes (avoid /court prefix matching issues on serverless)
app.post("/courts/add", async (req, res) => {
  const name = (req.body.name || '').trim() || 'Court';
  const password = (req.body.password || '').trim();
  if (password && password.length > 10) return res.redirect('/');
  try {
    await courtService.addCourt(name, password);
    res.redirect('/');
  } catch (err) {
    res.redirect('/');
  }
});

app.post("/court/:cid/delete", async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    await courtService.deleteCourt(cid);
    res.redirect('/?msg=court_deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
