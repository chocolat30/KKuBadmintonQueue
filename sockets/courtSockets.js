const courtService = require('../services/courtService');

function registerCourtHandlers(io) {
  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('join-court', async (courtId) => {
      const cid = Number(courtId);
      socket.join(`court:${cid}`);
      console.log(`Client ${socket.id} joined court:${cid}`);
      await courtService.broadcastCourtState(cid);
    });

    socket.on('leave-court', (courtId) => {
      socket.leave(`court:${courtId}`);
      console.log(`Client ${socket.id} left court:${courtId}`);
    });

    socket.on('join-queue', async (data) => {
      const { courtId, name } = data;
      const cid = Number(courtId);
      const trimmedName = (name || '').trim();
      if (!trimmedName) return;
      try {
        await courtService.joinQueue(cid, trimmedName);
      } catch (err) {
        console.error('Socket join-queue error:', err);
      }
    });

    socket.on('start-match', async (courtId) => {
      const cid = Number(courtId);
      try {
        await courtService.startMatch(cid);
      } catch (err) {
        console.error('Socket start-match error:', err);
      }
    });

    socket.on('reset-match', async (courtId) => {
      const cid = Number(courtId);
      try {
        await courtService.resetMatch(cid);
      } catch (err) {
        console.error('Socket reset-match error:', err);
      }
    });

    socket.on('rename-queue', async (data) => {
      const { courtId, queueId, name } = data;
      const cid = Number(courtId);
      const id = Number(queueId);
      const newName = (name || '').trim();
      if (!newName) return;
      try {
        await courtService.renamePlayer(cid, id, newName);
      } catch (err) {
        console.error('Socket rename-queue error:', err);
      }
    });

    socket.on('end-match', async (data) => {
      const { courtId, winner } = data;
      const cid = Number(courtId);
      if (!winner) return;
      try {
        await courtService.endMatch(cid, winner);
      } catch (err) {
        console.error('Socket end-match error:', err);
      }
    });

    socket.on('add-match', async (data) => {
      const { courtId, side } = data;
      const cid = Number(courtId);
      try {
        await courtService.updateMatchScore(cid, side, 1);
      } catch (err) {
        console.error('Socket add-match error:', err);
      }
    });

    socket.on('minus-match', async (data) => {
      const { courtId, side } = data;
      const cid = Number(courtId);
      try {
        await courtService.updateMatchScore(cid, side, -1);
      } catch (err) {
        console.error('Socket minus-match error:', err);
      }
    });

    socket.on('remove-queue', async (data) => {
      const { courtId, queueId } = data;
      const cid = Number(courtId);
      const id = Number(queueId);
      try {
        await courtService.removePlayerFromQueue(cid, id);
      } catch (err) {
        console.error('Socket remove-queue error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}

module.exports = { registerCourtHandlers };
