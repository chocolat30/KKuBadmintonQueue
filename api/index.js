const app = require("../app");

// Vercel serverless handler
// Note: WebSockets (socket.io) are NOT supported on Vercel serverless.
// Real-time updates will require polling or a separate WebSocket service.
module.exports = (req, res) => {
  return app(req, res);
};
