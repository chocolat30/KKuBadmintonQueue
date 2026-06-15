const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config().parsed || {};

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

// Initialize Service
courtService.init(io);

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

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
const port = process.env.PORT || 3000;
// server.listen(port, () => console.log(`Server running on port ${port}`));

module.exports = app;