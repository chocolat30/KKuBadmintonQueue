require("dotenv").config();
const { createApp } = require("./app");

const port = process.env.PORT || 3000;

const { server } = createApp();

// Process-level error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
server.listen(port, () => console.log(`Server running on port ${port}`));
