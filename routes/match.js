const express = require('express');
const router = express.Router();
const courtService = require('../services/courtService');

// Start match
router.get('/:cid/start', async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    await courtService.startMatch(cid);
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'match_exists' || err.message === 'not_enough_players') {
      return res.redirect(`/court/${cid}`);
    }
    res.status(500).send(err.message);
  }
});

// Reset match
router.get('/:cid/reset-match', async (req, res) => {
  const cid = Number(req.params.cid);
  try {
    await courtService.resetMatch(cid);
    res.json({ success: true, msg: 'reset' });
  } catch (err) {
    if (err.message === 'no_match') return res.redirect(`/court/${cid}?msg=nomatch`);
    res.status(500).send(err.message);
  }
});

// Add match count
router.get('/:cid/add-match/:side', async (req, res) => {
  const cid = Number(req.params.cid);
  const side = req.params.side;
  try {
    await courtService.updateMatchScore(cid, side, 1);
    res.redirect(`/court/${cid}`);
  } catch (err) {
    if (err.message === 'no_match') return res.redirect(`/court/${cid}?msg=nomatch`);
    res.status(500).send(err.message);
  }
});

// Minus match count
router.get('/:cid/minus-match/:side', async (req, res) => {
  const cid = Number(req.params.cid);
  const side = req.params.side;
  try {
    await courtService.updateMatchScore(cid, side, -1);
    res.redirect(`/court/${cid}`);
  } catch (err) {
    if (err.message === 'no_match') return res.redirect(`/court/${cid}?msg=nomatch`);
    if (err.message === 'invalid_score') return res.redirect(`/court/${cid}?msg=invalid`);
    res.status(500).send(err.message);
  }
});

// End match (winner)
router.get('/:cid/end', async (req, res) => {
  const cid = Number(req.params.cid);
  const winner = req.query.w;
  if (!winner) return res.redirect(`/court/${cid}?msg=nowinner`);
  try {
    await courtService.endMatch(cid, winner);
    res.redirect(`/court/${cid}`);
  } catch (err) {
    if (err.message === 'no_match') return res.redirect(`/court/${cid}?msg=nomatch`);
    res.status(500).send(err.message);
  }
});

module.exports = router;
