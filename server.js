const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const courtService = require("./services/courtService");
const { registerCourtHandlers } = require("./sockets/courtSockets");

const port = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`] }
});

// Initialize Service with socket.io
courtService.init(io);

// Register socket handlers
registerCourtHandlers(io);

// Process-level error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
server.listen(port, () => console.log(`Server running on port ${port}`));
