const courtService = require('../services/courtService');

// Register a socket event handler with consistent async error logging.
// Works for both sync and async handlers.
function on(socket, event, handler) {
  socket.on(event, (payload) => {
    Promise.resolve(handler(payload)).catch((err) => {
      console.error(`Socket '${event}' error:`, err);
    });
  });
}

// add-match / minus-match differ only in the score delta
const updateScore = (delta) => async (data) => {
  const { courtId, side } = data;
  await courtService.updateMatchScore(Number(courtId), side, delta);
};

function registerCourtHandlers(io) {
  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    on(socket, 'join-court', async (courtId) => {
      const cid = Number(courtId);
      socket.join(`court:${cid}`);
      console.log(`Client ${socket.id} joined court:${cid}`);
      await courtService.broadcastCourtState(cid);
    });

    on(socket, 'leave-court', (courtId) => {
      socket.leave(`court:${courtId}`);
      console.log(`Client ${socket.id} left court:${courtId}`);
    });

    on(socket, 'join-queue', async (data) => {
      const { courtId, name } = data;
      const trimmedName = (name || '').trim();
      if (!trimmedName) return;
      await courtService.joinQueue(Number(courtId), trimmedName);
    });

    on(socket, 'start-match', async (courtId) => {
      await courtService.startMatch(Number(courtId));
    });

    on(socket, 'reset-match', async (courtId) => {
      await courtService.resetMatch(Number(courtId));
    });

    on(socket, 'rename-queue', async (data) => {
      const { courtId, queueId, name } = data;
      const newName = (name || '').trim();
      if (!newName) return;
      await courtService.renamePlayer(Number(courtId), Number(queueId), newName);
    });

    on(socket, 'add-match', updateScore(1));
    on(socket, 'minus-match', updateScore(-1));

    on(socket, 'end-match', async (data) => {
      const { courtId, winner } = data;
      if (!winner) return;
      await courtService.endMatch(Number(courtId), winner);
    });

    on(socket, 'remove-queue', async (data) => {
      const { courtId, queueId } = data;
      await courtService.removePlayerFromQueue(Number(courtId), Number(queueId));
    });

    on(socket, 'walk-out', async (data) => {
      const { courtId, side } = data;
      await courtService.walkOut(Number(courtId), side);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}

module.exports = { registerCourtHandlers };
