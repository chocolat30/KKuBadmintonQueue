const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');
const { requireCourtApiAccess } = require('../helpers/courtAuth');

// All match mutations are POST + require the court access cookie.

// Start match (takes the first two players from the queue)
router.post('/:cid/start', requireCourtApiAccess, async (req, res) => {
  try {
    await courtService.startMatch(req.court.id);
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'match_exists' || err.message === 'not_enough_players') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// Reset match (return current teams to the queue)
router.post('/:cid/reset-match', requireCourtApiAccess, async (req, res) => {
  try {
    await courtService.resetMatch(req.court.id);
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'no_match') return res.status(409).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Add/minus a played match for one side
function scoreHandler(delta) {
  return async (req, res) => {
    const side = req.params.side;
    if (side !== 'A' && side !== 'B') {
      return res.status(400).json({ error: 'Invalid side' });
    }
    try {
      await courtService.updateMatchScore(req.court.id, side, delta);
      res.json({ success: true });
    } catch (err) {
      if (err.message === 'no_match') return res.status(409).json({ error: err.message });
      if (err.message === 'invalid_score') return res.status(400).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  };
}

router.post('/:cid/add-match/:side', requireCourtApiAccess, scoreHandler(1));
router.post('/:cid/minus-match/:side', requireCourtApiAccess, scoreHandler(-1));

// End match, recording the winner and pulling in the next pair(s)
router.post('/:cid/end', requireCourtApiAccess, async (req, res) => {
  const winner = (req.body.winner || '').trim();
  if (winner !== 'A' && winner !== 'B') {
    return res.status(400).json({ error: 'Invalid winner' });
  }
  try {
    await courtService.endMatch(req.court.id, winner);
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'no_match') return res.status(409).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
