const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");

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
  cors: { origin: "*" }
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

// Start server
server.listen(3000, () => console.log("Server running on port 3000"));
