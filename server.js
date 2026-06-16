const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config().parsed || {};
const port = process.env.PORT || 3000;

const db = require("./db");
const courtService = require("./services/courtService");
const courtRoutes = require("./routes/courts");
const queueRoutes = require("./routes/queue");
const matchRoutes = require("./routes/match");
const historyRoutes = require("./routes/history");
const { registerCourtHandlers } = require("./sockets/courtSockets");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`] }
});

// Cache-buster version from package.json
const APP_VERSION = require('./package.json').version;

// Initialize Service
courtService.init(io);

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public", {
  setHeaders: (res, path) => {
    if (path.endsWith("i18n.js")) {
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

// Sockets
registerCourtHandlers(io);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Process-level error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
server.listen(port, () => console.log(`Server running on port ${port}`));
